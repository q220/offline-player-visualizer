import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { loadChunkColumnData } from './raw-chunk-reader.js';
import { dimensionSlug } from '../../shared/constants.js';
import type { RegionInfo } from './region-loader.js';

/**
 * Heightmap shading constants (Dynmap-style).
 */
const SHADE_BRIGHTEN = 1.17;
const SHADE_DARKEN = 0.83;
const WATER_TINT_COLOR = [40, 50, 150];
const WATER_MAX_DEPTH_FOR_TINT = 30;

// Persistent cache directory (survives vite builds and git pulls)
const TILE_CACHE_DIR = path.resolve('.tile-cache');

/**
 * Get the path for a cached tile PNG.
 */
export function getTileCachePath(dimension: string, tx: number, ty: number): string {
  const slug = dimensionSlug(dimension);
  return path.join(TILE_CACHE_DIR, slug, `${tx}.${ty}.png`);
}

/**
 * Check if a tile is already cached on disk.
 */
export function isTileCached(dimension: string, tx: number, ty: number): boolean {
  return fs.existsSync(getTileCachePath(dimension, tx, ty));
}

/**
 * Render a single tile on demand and cache it to disk.
 * Tile coordinates: tx = region rx, ty = -rz - 1 (Y-flipped for Leaflet).
 * Returns the PNG buffer, or null if the region has no content.
 */
export async function renderTile(
  worldPath: string,
  dimension: string,
  tx: number,
  ty: number,
): Promise<Buffer | null> {
  // Check cache first
  const cachePath = getTileCachePath(dimension, tx, ty);
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath);
  }

  // Convert tile coords to region coords
  const rx = tx;
  const rz = -ty - 1;

  // Render the region
  const pixels = await renderRegionPixels(worldPath, dimension, rx, rz);
  if (!pixels) return null;

  // Save PNG to cache
  const dir = path.dirname(cachePath);
  fs.mkdirSync(dir, { recursive: true });

  const pngBuffer = await sharp(pixels, { raw: { width: 512, height: 512, channels: 4 } })
    .png()
    .toBuffer();

  fs.writeFileSync(cachePath, pngBuffer);
  return pngBuffer;
}

/**
 * Clear the tile cache for a dimension (or all dimensions).
 */
export function clearTileCache(dimension?: string): void {
  if (dimension) {
    const dir = path.join(TILE_CACHE_DIR, dimensionSlug(dimension));
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
      console.log(`Cleared tile cache for ${dimension}`);
    }
  } else {
    if (fs.existsSync(TILE_CACHE_DIR)) {
      fs.rmSync(TILE_CACHE_DIR, { recursive: true });
      console.log('Cleared all tile cache');
    }
  }
}

/**
 * Render a single region as a 512x512 RGBA buffer.
 * Y-flipped: row 0 = highest worldZ, row 511 = lowest worldZ.
 */
async function renderRegionPixels(
  worldPath: string,
  dimension: string,
  rx: number,
  rz: number,
): Promise<Buffer | null> {
  const pixels = Buffer.alloc(512 * 512 * 4);
  const heights = new Int16Array(512 * 512);
  const waterMap = new Uint8Array(512 * 512);
  const waterDepthMap = new Uint8Array(512 * 512);

  let hasContent = false;

  for (let cx = 0; cx < 32; cx++) {
    for (let cz = 0; cz < 32; cz++) {
      const chunkX = rx * 32 + cx;
      const chunkZ = rz * 32 + cz;
      const chunkData = await loadChunkColumnData(worldPath, dimension, chunkX, chunkZ);

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
 * Pre-render all tiles for a dimension's regions at startup.
 * Skips tiles already cached on disk, so repeat startups are fast.
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

    if (isTileCached(dimension, tx, ty)) {
      stats.cached++;
    } else {
      try {
        await renderTile(worldPath, dimension, tx, ty);
        stats.rendered++;
      } catch {
        stats.failed++;
      }
    }

    onProgress(i + 1, regions.length);
  }

  return stats;
}
