import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config.js';
import { playerStore } from './player-store.js';
import { dimensionSlug } from '../../shared/constants.js';

/**
 * Compute player density grid and render as a heatmap PNG with alpha.
 */
export async function renderHeatmap(
  dimension: string,
  opts?: { afterDate?: number; beforeDate?: number; id?: string },
): Promise<string> {
  const { minX, maxX, minZ, maxZ } = config.bounds;
  const width = maxX - minX;
  const height = maxZ - minZ;
  const { blurSigma } = config.heatmap;

  // Get players for this dimension
  let players = playerStore.getPlayersByDimension(dimension);

  if (opts?.afterDate) {
    const after = opts.afterDate;
    players = players.filter((p) => p.lastModified >= after);
  }
  if (opts?.beforeDate) {
    const before = opts.beforeDate;
    players = players.filter((p) => p.lastModified <= before);
  }

  console.log(
    `Rendering heatmap for ${dimensionSlug(dimension)}: ${players.length} players`,
  );

  // Build density grid
  const density = new Float32Array(width * height);

  for (const p of players) {
    const x = Math.floor(p.x) - minX;
    const z = Math.floor(p.z) - minZ;
    if (x >= 0 && x < width && z >= 0 && z < height) {
      density[z * width + x]++;
    }
  }

  // Apply Gaussian blur using sharp
  // First convert density to a single-channel image, blur, then read back
  let maxDensity = 1;
  for (let i = 0; i < density.length; i++) {
    if (density[i] > maxDensity) maxDensity = density[i];
  }

  // Normalize to 0-255 for single-channel image (use log scale)
  const normalized = Buffer.alloc(width * height);
  for (let i = 0; i < density.length; i++) {
    if (density[i] > 0) {
      // Log scale: log(1 + value) / log(1 + max)
      const logVal = Math.log1p(density[i]) / Math.log1p(maxDensity);
      normalized[i] = Math.round(logVal * 255);
    }
  }

  // Blur using sharp (skip blur if no players to avoid issues)
  let blurred: Buffer;
  if (players.length > 0) {
    blurred = await sharp(normalized, {
      raw: { width, height, channels: 1 },
    })
      .blur(blurSigma)
      .raw()
      .toBuffer();
  } else {
    blurred = normalized;
  }

  // Map blurred density to RGBA color gradient
  const pixels = Buffer.alloc(width * height * 4);

  for (let i = 0; i < blurred.length; i++) {
    const val = blurred[i] / 255; // 0..1
    const [r, g, b, a] = heatmapColor(val);
    const idx = i * 4;
    pixels[idx] = r;
    pixels[idx + 1] = g;
    pixels[idx + 2] = b;
    pixels[idx + 3] = a;
  }

  // Write PNG
  const slug = dimensionSlug(dimension);
  const outDir = config.staticDir;
  fs.mkdirSync(outDir, { recursive: true });

  const filename = opts?.id
    ? `heatmap-filtered-${opts.id}.png`
    : `heatmap-${slug}.png`;
  const outPath = path.join(outDir, filename);

  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(outPath);

  console.log(`Heatmap saved: ${outPath}`);
  return `/static/${filename}`;
}

/**
 * Map a normalized value (0..1) to a heatmap RGBA color.
 * 0.0 = transparent (no players)
 * 0.1 = blue (low density)
 * 0.4 = green (medium)
 * 0.7 = yellow (high)
 * 1.0 = red (extreme hotspot)
 */
function heatmapColor(val: number): [number, number, number, number] {
  if (val < 0.01) return [0, 0, 0, 0]; // transparent

  const alpha = Math.round(Math.min(val * 2, 1) * 153); // max alpha ~0.6 * 255

  let r: number, g: number, b: number;

  if (val < 0.25) {
    // Blue to cyan
    const t = val / 0.25;
    r = 0;
    g = Math.round(t * 255);
    b = 255;
  } else if (val < 0.5) {
    // Cyan to green
    const t = (val - 0.25) / 0.25;
    r = 0;
    g = 255;
    b = Math.round((1 - t) * 255);
  } else if (val < 0.75) {
    // Green to yellow
    const t = (val - 0.5) / 0.25;
    r = Math.round(t * 255);
    g = 255;
    b = 0;
  } else {
    // Yellow to red
    const t = (val - 0.75) / 0.25;
    r = 255;
    g = Math.round((1 - t) * 255);
    b = 0;
  }

  return [r, g, b, alpha];
}
