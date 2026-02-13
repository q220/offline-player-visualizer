import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config.js';
import { playerStore } from './player-store.js';
import { dimensionSlug } from '../../shared/constants.js';

/**
 * Compute player density grid and render as a heatmap PNG with alpha.
 * Uses float32 gaussian blur to avoid uint8 precision loss.
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
    const pixels = Buffer.alloc(width * height * 4);
    return await writeHeatmapPng(pixels, width, height, dimension, opts?.id);
  }

  // Build density grid (float32 for precision)
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

  // Find max density before blur
  let maxDensity = 0;
  for (let i = 0; i < density.length; i++) {
    if (density[i] > maxDensity) maxDensity = density[i];
  }
  console.log(`  Max density at single pixel: ${maxDensity}`);

  // Apply log scale to density before blur (compresses dynamic range)
  const logMax = Math.log1p(maxDensity);
  for (let i = 0; i < density.length; i++) {
    if (density[i] > 0) {
      density[i] = Math.log1p(density[i]) / logMax;
    }
  }

  // Compute blur sigma. Scale with map area relative to player count.
  const pixelsPerPlayer = (width * height) / inBoundsCount;
  // Smaller sigma for denser data, larger for sparser
  const blurSigma = Math.max(3, Math.min(30, Math.round(Math.sqrt(pixelsPerPlayer) * 0.8)));
  console.log(`  Blur sigma: ${blurSigma} (${pixelsPerPlayer.toFixed(0)} pixels/player)`);

  // Gaussian blur on float32 data (separable: horizontal then vertical)
  const blurred = gaussianBlurFloat32(density, width, height, blurSigma);

  // Find max blurred value for normalization
  let maxBlurred = 0;
  for (let i = 0; i < blurred.length; i++) {
    if (blurred[i] > maxBlurred) maxBlurred = blurred[i];
  }
  console.log(`  Max blurred value: ${maxBlurred.toFixed(6)}`);

  if (maxBlurred === 0) {
    const pixels = Buffer.alloc(width * height * 4);
    return await writeHeatmapPng(pixels, width, height, dimension, opts?.id);
  }

  // Map blurred density to RGBA color gradient
  const pixels = Buffer.alloc(width * height * 4);
  let coloredPixels = 0;

  for (let i = 0; i < blurred.length; i++) {
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

/**
 * Approximate gaussian blur using 3 passes of box blur (O(n) per pixel).
 * Much more precise than sharp's uint8 blur for sparse data.
 * 3-pass box blur closely approximates a gaussian (central limit theorem).
 */
function gaussianBlurFloat32(
  data: Float32Array,
  width: number,
  height: number,
  sigma: number,
): Float32Array {
  // Compute box sizes for 3-pass approximation of gaussian
  // See: http://blog.ivank.net/fastest-gaussian-blur.html
  const boxes = boxesForGauss(sigma, 3);

  let src = new Float32Array(data);
  let dst = new Float32Array(width * height);

  for (const boxRadius of boxes) {
    boxBlurH(src, dst, width, height, boxRadius);
    boxBlurV(dst, src, width, height, boxRadius);
  }

  return src;
}

function boxesForGauss(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);

  const sizes: number[] = [];
  for (let i = 0; i < n; i++) {
    sizes.push(i < m ? wl : wu);
  }
  return sizes.map(w => (w - 1) / 2); // return radii
}

function boxBlurH(scl: Float32Array, tcl: Float32Array, w: number, h: number, r: number): void {
  if (r < 1) { tcl.set(scl); return; }
  const iarr = 1 / (r + r + 1);
  for (let i = 0; i < h; i++) {
    let ti = i * w, li = ti, ri = ti + r;
    const fv = scl[ti], lv = scl[ti + w - 1];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += scl[ti + Math.min(j, w - 1)];
    for (let j = 0; j <= r; j++) {
      val += (ri < ti + w ? scl[ri] : lv) - fv;
      tcl[ti] = val * iarr;
      ri++; ti++;
    }
    for (let j = r + 1; j < w - r; j++) {
      val += scl[ri++] - scl[li++];
      tcl[ti++] = val * iarr;
    }
    for (let j = w - r; j < w; j++) {
      val += lv - scl[li++];
      tcl[ti++] = val * iarr;
    }
  }
}

function boxBlurV(scl: Float32Array, tcl: Float32Array, w: number, h: number, r: number): void {
  if (r < 1) { tcl.set(scl); return; }
  const iarr = 1 / (r + r + 1);
  for (let i = 0; i < w; i++) {
    let ti = i, li = ti, ri = ti + r * w;
    const fv = scl[ti], lv = scl[ti + w * (h - 1)];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += scl[ti + Math.min(j, h - 1) * w];
    for (let j = 0; j <= r; j++) {
      val += (ri < i + h * w ? scl[ri] : lv) - fv;
      tcl[ti] = val * iarr;
      ri += w; ti += w;
    }
    for (let j = r + 1; j < h - r; j++) {
      val += scl[ri] - scl[li];
      tcl[ti] = val * iarr;
      li += w; ri += w; ti += w;
    }
    for (let j = h - r; j < h; j++) {
      val += lv - scl[li];
      tcl[ti] = val * iarr;
      li += w; ti += w;
    }
  }
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
 */
function heatmapColor(val: number): [number, number, number, number] {
  if (val < 0.003) return [0, 0, 0, 0]; // truly zero = transparent

  // Alpha: ramp up so even low values are visible
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
