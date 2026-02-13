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

  if (players.length === 0) {
    // Write empty transparent image
    const pixels = Buffer.alloc(width * height * 4);
    return await writeHeatmapPng(pixels, width, height, dimension, opts?.id);
  }

  // Build density grid
  const density = new Float32Array(width * height);
  let inBoundsCount = 0;

  for (const p of players) {
    const x = Math.floor(p.x) - minX;
    const z = Math.floor(p.z) - minZ;
    if (x >= 0 && x < width && z >= 0 && z < height) {
      density[z * width + x]++;
      inBoundsCount++;
    }
  }

  console.log(`  ${inBoundsCount}/${players.length} players within map bounds`);

  if (inBoundsCount === 0) {
    const pixels = Buffer.alloc(width * height * 4);
    return await writeHeatmapPng(pixels, width, height, dimension, opts?.id);
  }

  // Find max density for normalization
  let maxDensity = 1;
  for (let i = 0; i < density.length; i++) {
    if (density[i] > maxDensity) maxDensity = density[i];
  }

  console.log(`  Max density at single pixel: ${maxDensity}`);

  // Normalize to 0-255 for single-channel image (use log scale)
  const normalized = Buffer.alloc(width * height);
  for (let i = 0; i < density.length; i++) {
    if (density[i] > 0) {
      // Log scale: log(1 + value) / log(1 + max)
      const logVal = Math.log1p(density[i]) / Math.log1p(maxDensity);
      normalized[i] = Math.round(logVal * 255);
    }
  }

  // Use a large blur sigma to make the heatmap visible at zoom-out.
  // Adaptive: scale sigma based on player density relative to map area.
  // More sparse = larger blur to make hotspots visible.
  const pixelsPerPlayer = (width * height) / inBoundsCount;
  // At 1 player per pixel, sigma ~3. At 100 pixels per player, sigma ~20. At 10000, sigma ~40.
  const blurSigma = Math.max(3, Math.min(50, Math.round(Math.sqrt(pixelsPerPlayer) * 1.5)));
  console.log(`  Blur sigma: ${blurSigma} (${pixelsPerPlayer.toFixed(0)} pixels/player)`);

  const blurred = await sharp(normalized, {
    raw: { width, height, channels: 1 },
  })
    .blur(blurSigma)
    .raw()
    .toBuffer();

  // Find max blurred value for better normalization
  let maxBlurred = 1;
  for (let i = 0; i < blurred.length; i++) {
    if (blurred[i] > maxBlurred) maxBlurred = blurred[i];
  }

  // Map blurred density to RGBA color gradient
  const pixels = Buffer.alloc(width * height * 4);
  let coloredPixels = 0;

  for (let i = 0; i < blurred.length; i++) {
    // Re-normalize after blur so the color range uses the full spectrum
    const val = blurred[i] / maxBlurred;
    const [r, g, b, a] = heatmapColor(val);
    const idx = i * 4;
    pixels[idx] = r;
    pixels[idx + 1] = g;
    pixels[idx + 2] = b;
    pixels[idx + 3] = a;
    if (a > 0) coloredPixels++;
  }

  console.log(`  Heatmap: ${coloredPixels}/${width * height} colored pixels (${(coloredPixels / (width * height) * 100).toFixed(1)}%)`);

  return await writeHeatmapPng(pixels, width, height, dimension, opts?.id);
}

async function writeHeatmapPng(
  pixels: Buffer,
  width: number,
  height: number,
  dimension: string,
  id?: string,
): Promise<string> {
  const slug = dimensionSlug(dimension);
  const outDir = config.staticDir;
  fs.mkdirSync(outDir, { recursive: true });

  const filename = id
    ? `heatmap-filtered-${id}.png`
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
 * Very low values still get a faint color so the heatmap is visible.
 */
function heatmapColor(val: number): [number, number, number, number] {
  if (val < 0.005) return [0, 0, 0, 0]; // truly zero = transparent

  // Alpha: ramp up quickly so even low values are visible
  // val 0.01 -> alpha ~40, val 0.1 -> alpha ~120, val 0.5+ -> alpha 180
  const alpha = Math.round(Math.min(40 + val * 280, 180));

  let r: number, g: number, b: number;

  if (val < 0.2) {
    // Blue (low density)
    const t = val / 0.2;
    r = 0;
    g = Math.round(t * 100);
    b = Math.round(150 + t * 105);
  } else if (val < 0.4) {
    // Blue to cyan
    const t = (val - 0.2) / 0.2;
    r = 0;
    g = Math.round(100 + t * 155);
    b = 255;
  } else if (val < 0.6) {
    // Cyan to yellow
    const t = (val - 0.4) / 0.2;
    r = Math.round(t * 255);
    g = 255;
    b = Math.round(255 * (1 - t));
  } else if (val < 0.8) {
    // Yellow to orange
    const t = (val - 0.6) / 0.2;
    r = 255;
    g = Math.round(255 * (1 - t * 0.6));
    b = 0;
  } else {
    // Orange to red
    const t = (val - 0.8) / 0.2;
    r = 255;
    g = Math.round(102 * (1 - t));
    b = 0;
  }

  return [r, g, b, alpha];
}
