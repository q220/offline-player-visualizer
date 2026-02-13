import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config.js';
import { loadChunk, initAnvil, listRegionFiles, parseRegionCoords } from './region-loader.js';
import { extractTopBlocks } from './chunk-processor.js';
import { dimensionSlug } from '../../shared/constants.js';

export async function renderBlockMap(
  worldPath: string,
  dimension: string,
  mcVersion: string,
): Promise<string> {
  await initAnvil(mcVersion);

  const { minX, maxX, minZ, maxZ } = config.bounds;
  const width = maxX - minX;
  const height = maxZ - minZ;

  // Create raw pixel buffer (RGBA)
  const pixels = Buffer.alloc(width * height * 4);

  // Discover which region files exist to only load real chunks
  const regionFiles = listRegionFiles(worldPath, dimension);
  const existingRegions = new Set<string>();
  for (const f of regionFiles) {
    const coords = parseRegionCoords(f);
    if (coords) existingRegions.add(`${coords.rx},${coords.rz}`);
  }

  // Calculate chunk range
  const minChunkX = Math.floor(minX / 16);
  const maxChunkX = Math.floor((maxX - 1) / 16);
  const minChunkZ = Math.floor(minZ / 16);
  const maxChunkZ = Math.floor((maxZ - 1) / 16);

  // Count only chunks in existing regions
  let totalChunks = 0;
  let processedChunks = 0;

  for (let cx = minChunkX; cx <= maxChunkX; cx++) {
    for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
      const rx = Math.floor(cx / 32);
      const rz = Math.floor(cz / 32);
      if (existingRegions.has(`${rx},${rz}`)) totalChunks++;
    }
  }

  console.log(
    `Rendering ${dimensionSlug(dimension)} block map: ${totalChunks} chunks in ${existingRegions.size} regions (${width}x${height} pixels)`,
  );

  if (totalChunks === 0) {
    // No regions - just write empty image
    const slug = dimensionSlug(dimension);
    const outDir = config.staticDir;
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `map-${slug}.png`);
    await sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(outPath);
    console.log(`Block map saved (empty): ${outPath}`);
    return `/static/map-${slug}.png`;
  }

  for (let cx = minChunkX; cx <= maxChunkX; cx++) {
    for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
      // Skip chunks in non-existent regions
      const rx = Math.floor(cx / 32);
      const rz = Math.floor(cz / 32);
      if (!existingRegions.has(`${rx},${rz}`)) continue;

      const chunk = await loadChunk(worldPath, dimension, cx, cz);
      const topBlocks = extractTopBlocks(chunk);

      // Copy chunk pixels to the image buffer
      for (let bx = 0; bx < 16; bx++) {
        for (let bz = 0; bz < 16; bz++) {
          const worldX = cx * 16 + bx;
          const worldZ = cz * 16 + bz;

          if (worldX < minX || worldX >= maxX || worldZ < minZ || worldZ >= maxZ) {
            continue;
          }

          const imgX = worldX - minX;
          const imgZ = worldZ - minZ;
          const srcIdx = (bz * 16 + bx) * 4;
          const dstIdx = (imgZ * width + imgX) * 4;

          pixels[dstIdx] = topBlocks[srcIdx];
          pixels[dstIdx + 1] = topBlocks[srcIdx + 1];
          pixels[dstIdx + 2] = topBlocks[srcIdx + 2];
          pixels[dstIdx + 3] = topBlocks[srcIdx + 3];
        }
      }

      processedChunks++;
      if (processedChunks % 100 === 0 || processedChunks === totalChunks) {
        console.log(
          `  ${processedChunks}/${totalChunks} chunks (${Math.round((processedChunks / totalChunks) * 100)}%)`,
        );
      }
    }
  }

  // Write PNG
  const slug = dimensionSlug(dimension);
  const outDir = config.staticDir;
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `map-${slug}.png`);

  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(outPath);

  console.log(`Block map saved: ${outPath}`);
  return `/static/map-${slug}.png`;
}
