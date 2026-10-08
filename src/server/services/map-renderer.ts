import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { loadChunkColumnData } from './raw-chunk-reader.js';
import { getRegionDir } from './world-scanner.js';
import { config } from '../config.js';
import { dimensionSlug } from '../../shared/constants.js';
import type { RegionInfo } from './region-loader.js';

/**
 * Heightmap shading constants (Dynmap-style).
 */
const SHADE_BRIGHTEN = 1.17;
const SHADE_DARKEN = 0.83;
const WATER_TINT_COLOR = [40, 50, 150];
const WATER_MAX_DEPTH_FOR_TINT = 30;

// Per-world tile cache (survives vite builds and git pulls)
const TILE_CACHE_DIR = path.join(config.cacheDir, 'tiles');

/** Tiles being rendered right now, so concurrent requests share one render */
const inFlight = new Map<string, Promise<TileResult>>();

interface TileResult {
  png: Buffer | null;
  rendered: boolean;
}

function getTileCachePath(dimension: string, tx: number, ty: number): string {
  return path.join(TILE_CACHE_DIR, dimensionSlug(dimension), `${tx}.${ty}.png`);
}

function mtimeOrNull(file: string): number | null {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Render a single tile on demand and cache it to disk. A cached tile is
 * re-rendered once its region file has been saved again.
 * Tile coordinates: tx = region rx, ty = -rz - 1 (Y-flipped for Leaflet).
 * Returns the PNG buffer, or null if the region has no content.
 */
export async function renderTile(
  worldPath: string,
  dimension: string,
  tx: number,
  ty: number,
): Promise<Buffer | null> {
  return (await ensureTile(worldPath, dimension, tx, ty)).png;
}

function ensureTile(worldPath: string, dimension: string, tx: number, ty: number): Promise<TileResult> {
  const cachePath = getTileCachePath(dimension, tx, ty);
  let pending = inFlight.get(cachePath);
  if (!pending) {
    pending = loadOrRenderTile(worldPath, dimension, tx, ty, cachePath)
      .finally(() => inFlight.delete(cachePath));
    inFlight.set(cachePath, pending);
  }
  return pending;
}

async function loadOrRenderTile(
  worldPath: string,
  dimension: string,
  tx: number,
  ty: number,
  cachePath: string,
): Promise<TileResult> {
  const regionDir = getRegionDir(worldPath, dimension);
  if (!regionDir) return { png: null, rendered: false };

  // Convert tile coords to region coords
  const regionPath = path.join(regionDir, `r.${tx}.${-ty - 1}.mca`);
  const regionMtime = mtimeOrNull(regionPath);
  if (regionMtime === null) return { png: null, rendered: false };

  const tileMtime = mtimeOrNull(cachePath);
  if (tileMtime !== null && tileMtime >= regionMtime) {
    return { png: await fs.promises.readFile(cachePath), rendered: false };
  }

  const pixels = await renderRegionPixels(await fs.promises.readFile(regionPath));
  if (!pixels) return { png: null, rendered: true };

  const png = await sharp(pixels, { raw: { width: 512, height: 512, channels: 4 } })
    .png()
    .toBuffer();

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.tmp`;
  await fs.promises.writeFile(tmp, png);
  await fs.promises.rename(tmp, cachePath);
  return { png, rendered: true };
}

/**
 * Render a single region as a 512x512 RGBA buffer.
 * Y-flipped: row 0 = highest worldZ, row 511 = lowest worldZ.
 */
async function renderRegionPixels(regionBuf: Buffer): Promise<Buffer | null> {
  const pixels = Buffer.alloc(512 * 512 * 4);
  const heights = new Int16Array(512 * 512);
  const waterMap = new Uint8Array(512 * 512);
  const waterDepthMap = new Uint8Array(512 * 512);

  let hasContent = false;

  for (let cx = 0; cx < 32; cx++) {
    for (let cz = 0; cz < 32; cz++) {
      const chunkData = await loadChunkColumnData(regionBuf, cx, cz);
      if (!chunkData) continue;

      for (let bx = 0; bx < 16; bx++) {
        for (let bz = 0; bz < 16; bz++) {
          const srcIdx = bz * 16 + bx;
          if (chunkData.pixels[srcIdx * 4 + 3] === 0) continue;

          const px = cx * 16 + bx;
          const py = 511 - (cz * 16 + bz);
          const dstIdx = py * 512 + px;
          const dstPixel = dstIdx * 4;

          pixels[dstPixel] = chunkData.pixels[srcIdx * 4];
          pixels[dstPixel + 1] = chunkData.pixels[srcIdx * 4 + 1];
          pixels[dstPixel + 2] = chunkData.pixels[srcIdx * 4 + 2];
          pixels[dstPixel + 3] = chunkData.pixels[srcIdx * 4 + 3];

          heights[dstIdx] = chunkData.heights[srcIdx];
          waterMap[dstIdx] = chunkData.isWater[srcIdx];
          waterDepthMap[dstIdx] = chunkData.waterDepth[srcIdx];

          hasContent = true;
        }
      }
    }
  }

  if (!hasContent) return null;

  // Apply heightmap shading and water tinting
  for (let py = 0; py < 512; py++) {
    for (let px = 0; px < 512; px++) {
      const idx = py * 512 + px;
      const pixelIdx = idx * 4;
      if (pixels[pixelIdx + 3] === 0) continue;

      let r = pixels[pixelIdx];
      let g = pixels[pixelIdx + 1];
      let b = pixels[pixelIdx + 2];

      // Heightmap shading: compare with row above (py-1 = higher worldZ = north)
      if (py > 0) {
        const northIdx = (py - 1) * 512 + px;
        if (pixels[northIdx * 4 + 3] > 0) {
          const heightDiff = heights[idx] - heights[northIdx];
          if (heightDiff > 0) {
            const factor = Math.min(SHADE_BRIGHTEN, 1 + heightDiff * 0.04);
            r = Math.min(255, Math.round(r * factor));
            g = Math.min(255, Math.round(g * factor));
            b = Math.min(255, Math.round(b * factor));
          } else if (heightDiff < 0) {
            const factor = Math.max(SHADE_DARKEN, 1 + heightDiff * 0.04);
            r = Math.max(0, Math.round(r * factor));
            g = Math.max(0, Math.round(g * factor));
            b = Math.max(0, Math.round(b * factor));
          }
        }
      }

      if (waterMap[idx]) {
        const depth = waterDepthMap[idx];
        const blend = Math.min(0.6, (depth / WATER_MAX_DEPTH_FOR_TINT) * 0.6);
        r = Math.round(r * (1 - blend) + WATER_TINT_COLOR[0] * blend);
        g = Math.round(g * (1 - blend) + WATER_TINT_COLOR[1] * blend);
        b = Math.round(b * (1 - blend) + WATER_TINT_COLOR[2] * blend);
        const darken = Math.max(0.7, 1 - depth * 0.008);
        r = Math.round(r * darken);
        g = Math.round(g * darken);
        b = Math.round(b * darken);
      }

      pixels[pixelIdx] = r;
      pixels[pixelIdx + 1] = g;
      pixels[pixelIdx + 2] = b;
    }
  }

  return pixels;
}

/**
 * Pre-render all tiles for a dimension's regions.
 * Skips tiles that are still fresh on disk, so repeat startups are fast.
 */
export async function preRenderTiles(
  worldPath: string,
  dimension: string,
  regions: RegionInfo[],
  onProgress: (done: number, total: number) => void,
): Promise<{ rendered: number; cached: number; failed: number }> {
  const stats = { rendered: 0, cached: 0, failed: 0 };

  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    const tx = r.rx;
    const ty = -r.rz - 1;

    try {
      const { rendered } = await ensureTile(worldPath, dimension, tx, ty);
      if (rendered) stats.rendered++;
      else stats.cached++;
    } catch {
      stats.failed++;
    }

    onProgress(i + 1, regions.length);
  }

  return stats;
}
