import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config.js';
import { listRegionFiles, parseRegionCoords } from './region-loader.js';
import { loadChunkColumnData } from './raw-chunk-reader.js';
import { dimensionSlug } from '../../shared/constants.js';

/**
 * Heightmap shading constants (Dynmap-style).
 */
const SHADE_BRIGHTEN = 1.17;
const SHADE_DARKEN = 0.83;
const WATER_TINT_COLOR = [40, 50, 150];
const WATER_MAX_DEPTH_FOR_TINT = 30;

/**
 * Render per-region tiles (512x512 each) for a dimension.
 * Each tile is saved as tiles/{slug}/{tx}.{ty}.png where:
 *   tx = region rx
 *   ty = -rz - 1  (Y-flipped for Leaflet CRS.Simple)
 * Returns the list of tile coordinates rendered.
 */
export async function renderTiles(
  worldPath: string,
  dimension: string,
  _mcVersion: string,
): Promise<{ tx: number; ty: number }[]> {
  const slug = dimensionSlug(dimension);
  const tileDir = path.join(config.staticDir, 'tiles', slug);
  fs.mkdirSync(tileDir, { recursive: true });

  const regionFiles = listRegionFiles(worldPath, dimension);
  console.log(`Rendering ${slug} tiles: ${regionFiles.length} region files`);

  if (regionFiles.length === 0) return [];

  const tiles: { tx: number; ty: number }[] = [];
  let rendered = 0;

  for (const f of regionFiles) {
    const coords = parseRegionCoords(f);
    if (!coords) continue;

    const { rx, rz } = coords;
    const tileResult = await renderRegionTile(worldPath, dimension, rx, rz);

    if (tileResult) {
      const tx = rx;
      const ty = -rz - 1;
      const tilePath = path.join(tileDir, `${tx}.${ty}.png`);

      await sharp(tileResult, { raw: { width: 512, height: 512, channels: 4 } })
        .png()
        .toFile(tilePath);

      tiles.push({ tx, ty });
    }

    rendered++;
    if (rendered % 10 === 0 || rendered === regionFiles.length) {
      console.log(`  ${rendered}/${regionFiles.length} regions processed (${tiles.length} tiles with content)`);
    }
  }

  console.log(`Tiles saved: ${tiles.length} tiles to ${tileDir}`);
  return tiles;
}

/**
 * Render a single region as a 512x512 RGBA buffer.
 * The image is Y-flipped: row 0 = highest worldZ, row 511 = lowest worldZ.
 * This matches Leaflet's CRS.Simple tile system where pixel Y increases downward.
 */
async function renderRegionTile(
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

  // Load all 32x32 chunks in this region
  for (let cx = 0; cx < 32; cx++) {
    for (let cz = 0; cz < 32; cz++) {
      const chunkX = rx * 32 + cx;
      const chunkZ = rz * 32 + cz;
      const chunkData = await loadChunkColumnData(worldPath, dimension, chunkX, chunkZ);

      for (let bx = 0; bx < 16; bx++) {
        for (let bz = 0; bz < 16; bz++) {
          const srcIdx = bz * 16 + bx;

          // Skip empty blocks
          if (chunkData.pixels[srcIdx * 4 + 3] === 0) continue;

          // Tile pixel position (Y-flipped: high Z at top)
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

  // Apply heightmap shading and water tinting.
  // Note: shading compares with the pixel above (py-1) which is the HIGHER worldZ
  // (north neighbor in Minecraft = higher Z = lower py in our Y-flipped image).
  // So comparing with py-1 gives us the north neighbor, which is correct for
  // Dynmap-style "sun from north" shading.
  for (let py = 0; py < 512; py++) {
    for (let px = 0; px < 512; px++) {
      const idx = py * 512 + px;
      const pixelIdx = idx * 4;

      if (pixels[pixelIdx + 3] === 0) continue;

      let r = pixels[pixelIdx];
      let g = pixels[pixelIdx + 1];
      let b = pixels[pixelIdx + 2];

      // Heightmap shading: compare with northern neighbor (py+1 = lower worldZ = south)
      // Actually in our flipped image: py-1 = higher worldZ = north in MC.
      // We want: if current is higher than north → brighten (sunlit slope facing south)
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

      // Water depth tinting
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

// Keep old API name for compatibility but redirect to tile rendering
export async function renderBlockMap(
  worldPath: string,
  dimension: string,
  mcVersion: string,
): Promise<string> {
  await renderTiles(worldPath, dimension, mcVersion);
  return `/static/tiles/${dimensionSlug(dimension)}/`;
}
