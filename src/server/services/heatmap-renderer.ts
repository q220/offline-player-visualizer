import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config.js';
import { playerStore } from './player-store.js';
import { dimensionSlug } from '../../shared/constants.js';

/** Chunk size in blocks */
const CHUNK_SIZE = 16;

export interface HeatmapResult {
  url: string;
  contoursUrl: string;
  maxPerChunk: number;
  totalPlayers: number;
}

export interface ContourData {
  levels: ContourLevel[];
}

export interface ContourLevel {
  value: number;          // players per chunk (16x16 blocks)
  lines: number[][][];    // polylines: [[x,z], [x,z], ...]
}

/**
 * Render heatmap at chunk resolution (1px = 16x16 blocks).
 * Much smaller image, better blur, clearer visualization.
 */
export async function renderHeatmap(
  dimension: string,
  opts?: {
    afterDate?: number;
    beforeDate?: number;
    id?: string;
    viewport?: { minX: number; maxX: number; minZ: number; maxZ: number };
  },
): Promise<HeatmapResult> {
  const { minX, maxX, minZ, maxZ } = config.bounds;

  // Chunk-resolution dimensions
  const chunkW = Math.ceil((maxX - minX) / CHUNK_SIZE);
  const chunkH = Math.ceil((maxZ - minZ) / CHUNK_SIZE);

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
    `Rendering heatmap for ${dimensionSlug(dimension)}: ${players.length} players (${chunkW}x${chunkH} chunks)`,
  );

  const emptyResult: HeatmapResult = {
    url: '',
    contoursUrl: '',
    maxPerChunk: 0,
    totalPlayers: 0,
  };

  if (players.length === 0 || chunkW <= 0 || chunkH <= 0) {
    const pixels = Buffer.alloc(Math.max(1, chunkW) * Math.max(1, chunkH) * 4);
    emptyResult.url = await writeHeatmapPng(pixels, Math.max(1, chunkW), Math.max(1, chunkH), dimension, opts?.id);
    return emptyResult;
  }

  // Build chunk-resolution density grid
  const density = new Float32Array(chunkW * chunkH);
  let inBoundsCount = 0;

  for (const p of players) {
    const cx = Math.floor((p.x - minX) / CHUNK_SIZE);
    const cz = Math.floor((p.z - minZ) / CHUNK_SIZE);
    if (cx >= 0 && cx < chunkW && cz >= 0 && cz < chunkH) {
      density[cz * chunkW + cx]++;
      inBoundsCount++;
    }
  }

  console.log(`  ${inBoundsCount}/${players.length} players within map bounds`);

  if (inBoundsCount === 0) {
    const pixels = Buffer.alloc(chunkW * chunkH * 4);
    emptyResult.url = await writeHeatmapPng(pixels, chunkW, chunkH, dimension, opts?.id);
    return emptyResult;
  }

  // Find max density (players per chunk)
  let maxDensity = 0;
  for (let i = 0; i < density.length; i++) {
    if (density[i] > maxDensity) maxDensity = density[i];
  }
  // Density distribution diagnostics
  let nonZeroChunks = 0;
  let onePlayerChunks = 0;
  const densityBuckets = [0, 0, 0, 0, 0]; // 1, 2-5, 6-10, 11-50, 50+
  for (let i = 0; i < density.length; i++) {
    if (density[i] > 0) {
      nonZeroChunks++;
      if (density[i] === 1) { onePlayerChunks++; densityBuckets[0]++; }
      else if (density[i] <= 5) densityBuckets[1]++;
      else if (density[i] <= 10) densityBuckets[2]++;
      else if (density[i] <= 50) densityBuckets[3]++;
      else densityBuckets[4]++;
    }
  }
  console.log(`  Max density: ${maxDensity} players/chunk`);
  console.log(`  Non-zero chunks: ${nonZeroChunks}/${chunkW * chunkH} (${(nonZeroChunks / (chunkW * chunkH) * 100).toFixed(1)}%)`);
  console.log(`  Distribution: 1p=${densityBuckets[0]} 2-5p=${densityBuckets[1]} 6-10p=${densityBuckets[2]} 11-50p=${densityBuckets[3]} 50+p=${densityBuckets[4]}`);

  // Copy raw density for contour extraction (before transforms)
  const rawDensity = new Float32Array(density);

  // Apply sqrt scale (gentler than log — preserves low-density detail)
  const sqrtMax = Math.sqrt(maxDensity);
  for (let i = 0; i < density.length; i++) {
    if (density[i] > 0) {
      density[i] = Math.sqrt(density[i]) / sqrtMax;
    }
  }

  // Blur — scale with world size, not just density
  // Sparse data needs a wide kernel to create meaningful gradients
  const worldDiag = Math.sqrt(chunkW * chunkW + chunkH * chunkH);
  const blurSigma = Math.max(6, Math.min(30, Math.round(worldDiag / 25)));
  console.log(`  Blur sigma: ${blurSigma} (chunk resolution, world diagonal ${Math.round(worldDiag)} chunks)`);

  const blurred = gaussianBlurFloat32(density, chunkW, chunkH, blurSigma);

  // Normalize — if viewport is given, normalize to the viewport area only
  let maxBlurred = 0;
  if (opts?.viewport) {
    const vp = opts.viewport;
    const vpMinCX = Math.max(0, Math.floor((vp.minX - minX) / CHUNK_SIZE));
    const vpMaxCX = Math.min(chunkW, Math.ceil((vp.maxX - minX) / CHUNK_SIZE));
    const vpMinCZ = Math.max(0, Math.floor((vp.minZ - minZ) / CHUNK_SIZE));
    const vpMaxCZ = Math.min(chunkH, Math.ceil((vp.maxZ - minZ) / CHUNK_SIZE));
    for (let cz = vpMinCZ; cz < vpMaxCZ; cz++) {
      for (let cx = vpMinCX; cx < vpMaxCX; cx++) {
        const v = blurred[cz * chunkW + cx];
        if (v > maxBlurred) maxBlurred = v;
      }
    }
    console.log(`  Viewport normalization: chunks [${vpMinCX}..${vpMaxCX}] x [${vpMinCZ}..${vpMaxCZ}], maxBlurred=${maxBlurred.toFixed(4)}`);
  } else {
    for (let i = 0; i < blurred.length; i++) {
      if (blurred[i] > maxBlurred) maxBlurred = blurred[i];
    }
  }

  if (maxBlurred === 0) {
    const pixels = Buffer.alloc(chunkW * chunkH * 4);
    emptyResult.url = await writeHeatmapPng(pixels, chunkW, chunkH, dimension, opts?.id);
    return emptyResult;
  }

  // Map to RGBA
  const pixels = Buffer.alloc(chunkW * chunkH * 4);
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

  console.log(`  Heatmap: ${coloredPixels}/${chunkW * chunkH} colored pixels (${(coloredPixels / (chunkW * chunkH) * 100).toFixed(1)}%)`);

  const url = await writeHeatmapPng(pixels, chunkW, chunkH, dimension, opts?.id);

  // Generate contour lines from blurred raw density
  const contourSigma = Math.max(3, blurSigma);
  const rawBlurred = gaussianBlurFloat32(rawDensity, chunkW, chunkH, contourSigma);
  const contourLevels = computeNiceLevels(maxDensity);
  const contours = extractContours(rawBlurred, chunkW, chunkH, contourLevels, minX, minZ);
  const contoursUrl = await writeContourJson(contours, dimension, opts?.id);
  console.log(`  Contours: ${contourLevels.length} levels [${contourLevels.join(', ')}], ${contours.levels.reduce((s, l) => s + l.lines.length, 0)} polylines`);

  return { url, contoursUrl, maxPerChunk: maxDensity, totalPlayers: inBoundsCount };
}

// ---- Gaussian blur (3-pass box blur approximation on Float32) ----

function gaussianBlurFloat32(data: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const boxes = boxesForGauss(sigma, 3);
  let src = new Float32Array(data);
  let dst = new Float32Array(w * h);
  for (const r of boxes) {
    boxBlurH(src, dst, w, h, r);
    boxBlurV(dst, src, w, h, r);
  }
  return src;
}

function boxesForGauss(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes.map(w => (w - 1) / 2);
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
      tcl[ti] = val * iarr; ri++; ti++;
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
      tcl[ti] = val * iarr; ri += w; ti += w;
    }
    for (let j = r + 1; j < h - r; j++) {
      val += scl[ri] - scl[li];
      tcl[ti] = val * iarr; li += w; ri += w; ti += w;
    }
    for (let j = h - r; j < h; j++) {
      val += lv - scl[li];
      tcl[ti] = val * iarr; li += w; ti += w;
    }
  }
}

// ---- PNG output ----

async function writeHeatmapPng(
  pixels: Buffer, width: number, height: number,
  dimension: string, id?: string,
): Promise<string> {
  const slug = dimensionSlug(dimension);
  const outDir = config.staticDir;
  fs.mkdirSync(outDir, { recursive: true });
  const filename = id ? `heatmap-filtered-${id}.png` : `heatmap-${slug}.png`;
  const outPath = path.join(outDir, filename);
  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(outPath);
  console.log(`Heatmap saved: ${outPath} (${width}x${height})`);
  return `/static/${filename}`;
}

// ---- Contour generation (marching squares) ----

function computeNiceLevels(maxDensity: number): number[] {
  if (maxDensity < 2) return [];

  const all: number[] = [];
  let mag = 1;
  while (mag <= maxDensity * 10) {
    for (const base of [1, 2, 5]) {
      const v = base * mag;
      if (v >= 2 && v <= maxDensity * 0.95) {
        all.push(v);
      }
    }
    mag *= 10;
  }

  if (all.length <= 6) return all;

  // Pick ~6 evenly spaced levels
  const result: number[] = [];
  const step = (all.length - 1) / 5;
  for (let i = 0; i < 6; i++) {
    result.push(all[Math.round(i * step)]);
  }
  return result;
}

function extractContours(
  grid: Float32Array, w: number, h: number,
  levels: number[], originX: number, originZ: number,
): ContourData {
  const result: ContourData = { levels: [] };

  for (const threshold of levels) {
    const segments = marchingSquares(grid, w, h, threshold);
    const polylines = connectSegments(segments);

    // Convert chunk coords to world coords, simplify, filter short lines
    const worldLines = polylines
      .map(pl => pl.map(([cx, cz]): [number, number] => [
        originX + cx * CHUNK_SIZE,
        originZ + cz * CHUNK_SIZE,
      ]))
      .map(pl => simplifyPolyline(pl, CHUNK_SIZE * 0.5))
      .filter(pl => pl.length >= 3 && polylineLength(pl) >= CHUNK_SIZE * 3);

    if (worldLines.length > 0) {
      // Round coordinates to integers
      const rounded = worldLines.map(pl =>
        pl.map(([x, z]) => [Math.round(x), Math.round(z)]),
      );
      result.levels.push({ value: threshold, lines: rounded });
    }
  }

  return result;
}

function marchingSquares(
  grid: Float32Array, w: number, h: number, threshold: number,
): Array<[[number, number], [number, number]]> {
  const segments: Array<[[number, number], [number, number]]> = [];

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = grid[y * w + x];
      const tr = grid[y * w + x + 1];
      const bl = grid[(y + 1) * w + x];
      const br = grid[(y + 1) * w + x + 1];

      let code = 0;
      if (tl >= threshold) code |= 8;
      if (tr >= threshold) code |= 4;
      if (br >= threshold) code |= 2;
      if (bl >= threshold) code |= 1;

      if (code === 0 || code === 15) continue;

      const lerp = (a: number, b: number) => {
        const d = b - a;
        if (Math.abs(d) < 1e-10) return 0.5;
        return (threshold - a) / d;
      };

      const top: [number, number] = [x + lerp(tl, tr), y];
      const right: [number, number] = [x + 1, y + lerp(tr, br)];
      const bottom: [number, number] = [x + lerp(bl, br), y + 1];
      const left: [number, number] = [x, y + lerp(tl, bl)];

      switch (code) {
        case 1: case 14: segments.push([left, bottom]); break;
        case 2: case 13: segments.push([bottom, right]); break;
        case 3: case 12: segments.push([left, right]); break;
        case 4: case 11: segments.push([top, right]); break;
        case 5: segments.push([left, top]); segments.push([bottom, right]); break;
        case 6: case 9: segments.push([top, bottom]); break;
        case 7: case 8: segments.push([left, top]); break;
        case 10: segments.push([top, right]); segments.push([left, bottom]); break;
      }
    }
  }

  return segments;
}

function connectSegments(
  segments: Array<[[number, number], [number, number]]>,
): Array<[number, number][]> {
  if (segments.length === 0) return [];

  const key = (p: [number, number]) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const adj = new Map<string, number[]>();

  for (let i = 0; i < segments.length; i++) {
    for (const p of segments[i]) {
      const k = key(p);
      if (!adj.has(k)) adj.set(k, []);
      adj.get(k)!.push(i);
    }
  }

  const used = new Set<number>();
  const polylines: Array<[number, number][]> = [];

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    used.add(i);

    const polyline: [number, number][] = [segments[i][0], segments[i][1]];

    // Extend tail
    let extended = true;
    while (extended) {
      extended = false;
      const tail = polyline[polyline.length - 1];
      const neighbors = adj.get(key(tail)) || [];
      for (const j of neighbors) {
        if (used.has(j)) continue;
        used.add(j);
        const [a, b] = segments[j];
        polyline.push(key(a) === key(tail) ? b : a);
        extended = true;
        break;
      }
    }

    // Extend head
    extended = true;
    while (extended) {
      extended = false;
      const head = polyline[0];
      const neighbors = adj.get(key(head)) || [];
      for (const j of neighbors) {
        if (used.has(j)) continue;
        used.add(j);
        const [a, b] = segments[j];
        polyline.unshift(key(a) === key(head) ? b : a);
        extended = true;
        break;
      }
    }

    polylines.push(polyline);
  }

  return polylines;
}

function simplifyPolyline(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIdx = 0;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const dist = ptLineDist(px, py, ax, ay, bx, by);
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }

  if (maxDist > epsilon) {
    const left = simplifyPolyline(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyPolyline(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [points[0], points[points.length - 1]];
}

function ptLineDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.sqrt((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2);
}

function polylineLength(points: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

async function writeContourJson(
  data: ContourData, dimension: string, id?: string,
): Promise<string> {
  const slug = dimensionSlug(dimension);
  const outDir = config.staticDir;
  fs.mkdirSync(outDir, { recursive: true });
  const filename = id ? `contours-filtered-${id}.json` : `contours-${slug}.json`;
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, JSON.stringify(data));
  console.log(`  Contours saved: ${outPath}`);
  return `/static/${filename}`;
}

// ---- Color mapping ----

function heatmapColor(val: number): [number, number, number, number] {
  // Very low cutoff — show even the faintest signal
  if (val < 0.001) return [0, 0, 0, 0];

  // Higher base alpha so low-density areas are clearly visible
  const alpha = Math.round(Math.min(100 + val * 155, 230));
  let r: number, g: number, b: number;

  if (val < 0.15) {
    // Deep blue → bright blue (visible on dark backgrounds)
    const t = val / 0.15;
    r = Math.round(30 + t * 10); g = Math.round(60 + t * 80); b = Math.round(180 + t * 75);
  } else if (val < 0.35) {
    // Blue → cyan
    const t = (val - 0.15) / 0.2;
    r = Math.round(40 * (1 - t)); g = Math.round(140 + t * 115); b = 255;
  } else if (val < 0.55) {
    // Cyan → green-yellow
    const t = (val - 0.35) / 0.2;
    r = Math.round(t * 200); g = 255; b = Math.round(255 * (1 - t));
  } else if (val < 0.75) {
    // Yellow → orange
    const t = (val - 0.55) / 0.2;
    r = Math.round(200 + t * 55); g = Math.round(255 - t * 100); b = 0;
  } else {
    // Orange → red
    const t = (val - 0.75) / 0.25;
    r = 255; g = Math.round(155 * (1 - t)); b = 0;
  }

  return [r, g, b, alpha];
}
