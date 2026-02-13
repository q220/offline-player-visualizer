import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import nbt from 'prismarine-nbt';
const parseNBT = nbt.parse;
const simplifyNBT = nbt.simplify;
import { LRUCache } from 'lru-cache';
import { getRegionDir } from './world-scanner.js';
import { getBlockColor } from '../data/block-colors.js';

/**
 * Raw .mca region file reader that bypasses prismarine-provider-anvil.
 * Reads chunk NBT directly and extracts top-block colors per column.
 * This handles MC versions that prismarine doesn't fully support (e.g. 1.21.4).
 */

export interface ChunkColumnData {
  /** 16x16 RGBA pixels (16*16*4 = 1024 bytes) */
  pixels: Uint8Array;
  /** 16x16 height values (Y of the top non-air block) */
  heights: Int16Array;
  /** 16x16 boolean: true if the top block is water/lava */
  isWater: Uint8Array;
  /** 16x16 water depth (blocks of water above the solid block) */
  waterDepth: Uint8Array;
}

// Cache parsed chunk column data
const chunkCache = new LRUCache<string, ChunkColumnData>({ max: 500 });

// Cache region file buffers to avoid re-reading
const regionCache = new LRUCache<string, Buffer>({ max: 50 });

function getRegionBuffer(regionPath: string): Buffer | null {
  let buf = regionCache.get(regionPath);
  if (buf !== undefined) return buf;

  try {
    buf = fs.readFileSync(regionPath);
    regionCache.set(regionPath, buf);
    return buf;
  } catch {
    return null;
  }
}

function decompressChunkData(regionBuf: Buffer, localX: number, localZ: number): Buffer | null {
  const offsetIndex = (localX + localZ * 32) * 4;
  if (offsetIndex + 4 > regionBuf.length) return null;

  const offsetVal = regionBuf.readUInt32BE(offsetIndex);
  if (offsetVal === 0) return null;

  const sectorNumber = offsetVal >> 8;
  const byteOffset = sectorNumber * 4096;

  if (byteOffset + 5 > regionBuf.length) return null;

  const dataLength = regionBuf.readUInt32BE(byteOffset) - 1;
  const compressionType = regionBuf.readUInt8(byteOffset + 4);

  if (dataLength <= 0 || byteOffset + 5 + dataLength > regionBuf.length) return null;

  const compressedData = regionBuf.subarray(byteOffset + 5, byteOffset + 5 + dataLength);

  if (compressionType === 2) {
    return zlib.inflateSync(compressedData);
  } else if (compressionType === 1) {
    return zlib.gunzipSync(compressedData);
  }

  return null;
}

function extractPaletteIndex(
  data: bigint[],
  blockIndex: number,
  bitsPerEntry: number,
): number {
  if (bitsPerEntry === 0) return 0;

  const valuesPerLong = Math.floor(64 / bitsPerEntry);
  const longIndex = Math.floor(blockIndex / valuesPerLong);
  const bitOffset = (blockIndex % valuesPerLong) * bitsPerEntry;

  if (longIndex >= data.length) return 0;

  const mask = (1n << BigInt(bitsPerEntry)) - 1n;
  const value = (data[longIndex] >> BigInt(bitOffset)) & mask;
  return Number(value);
}

function toLongArray(rawData: any): bigint[] {
  if (!rawData) return [];

  if (Array.isArray(rawData)) {
    return rawData.map((pair: any) => {
      if (Array.isArray(pair) && pair.length === 2) {
        const hi = BigInt(pair[0]) & 0xFFFFFFFFn;
        const lo = BigInt(pair[1]) & 0xFFFFFFFFn;
        return (hi << 32n) | lo;
      }
      if (typeof pair === 'bigint') return pair;
      return BigInt(pair);
    });
  }

  return [];
}

interface SectionData {
  y: number;
  palette: string[];
  data: bigint[];
  bitsPerEntry: number;
}

const AIR_BLOCKS = new Set(['air', 'cave_air', 'void_air', '']);
const WATER_BLOCKS = new Set(['water', 'lava', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']);
const TRANSPARENT_WATER = new Set(['water', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']);

async function parseSectionsFromNBT(nbtData: Buffer): Promise<{ sections: SectionData[]; minY: number }> {
  const { parsed } = await parseNBT(nbtData);
  const root = simplifyNBT(parsed);

  const sections: SectionData[] = [];
  let minY = -64;

  const rawSectionsVal = root.sections || root.Sections;
  const rawSections = Array.isArray(rawSectionsVal) ? rawSectionsVal : [];
  if (root.yPos !== undefined) {
    minY = root.yPos * 16;
  }

  for (const sec of rawSections) {
    if (!sec) continue;

    const sectionY = sec.Y ?? sec.y;
    if (sectionY === undefined) continue;

    const blockStates = sec.block_states || sec.BlockStates;
    if (!blockStates) continue;

    const palette = blockStates.palette || blockStates.Palette;
    if (!palette || !Array.isArray(palette) || palette.length === 0) continue;

    const blockNames: string[] = palette.map((entry: any) => {
      const name = entry.Name || entry.name || '';
      return name.replace('minecraft:', '');
    });

    const rawData = blockStates.data || blockStates.Data;
    if (!rawData || palette.length <= 1) {
      sections.push({
        y: sectionY,
        palette: blockNames,
        data: [],
        bitsPerEntry: 0,
      });
      continue;
    }

    const longData = toLongArray(rawData);
    const bitsPerEntry = Math.max(4, Math.ceil(Math.log2(palette.length)));

    sections.push({
      y: sectionY,
      palette: blockNames,
      data: longData,
      bitsPerEntry,
    });
  }

  sections.sort((a, b) => b.y - a.y);

  return { sections, minY };
}

function regionCoord(chunkCoord: number): number {
  return Math.floor(chunkCoord / 32);
}

function getBlockName(sec: SectionData, blockIndex: number): string {
  if (sec.bitsPerEntry === 0) {
    return sec.palette[0] || '';
  }
  const paletteIdx = extractPaletteIndex(sec.data, blockIndex, sec.bitsPerEntry);
  return sec.palette[paletteIdx] || '';
}

/**
 * Load a chunk and extract top-block colors, heights, and water info.
 */
export async function loadChunkColumnData(
  worldPath: string,
  dimension: string,
  chunkX: number,
  chunkZ: number,
): Promise<ChunkColumnData> {
  const key = `raw:${dimension}:${chunkX}:${chunkZ}`;
  const cached = chunkCache.get(key);
  if (cached !== undefined) return cached;

  const result: ChunkColumnData = {
    pixels: new Uint8Array(16 * 16 * 4),
    heights: new Int16Array(16 * 16),
    isWater: new Uint8Array(16 * 16),
    waterDepth: new Uint8Array(16 * 16),
  };

  const regionDir = getRegionDir(worldPath, dimension);
  const rx = regionCoord(chunkX);
  const rz = regionCoord(chunkZ);

  const regionPath = path.join(regionDir, `r.${rx}.${rz}.mca`);
  const regionBuf = getRegionBuffer(regionPath);
  if (!regionBuf) {
    chunkCache.set(key, result);
    return result;
  }

  const localX = ((chunkX % 32) + 32) % 32;
  const localZ = ((chunkZ % 32) + 32) % 32;

  const nbtData = decompressChunkData(regionBuf, localX, localZ);
  if (!nbtData) {
    chunkCache.set(key, result);
    return result;
  }

  try {
    const { sections } = await parseSectionsFromNBT(nbtData);

    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        const colIdx = z * 16 + x;
        let foundSolid = false;
        let waterSurfaceY = -9999;
        let solidY = -9999;

        // Sections are sorted top-down
        for (const sec of sections) {
          if (foundSolid) break;

          for (let sy = 15; sy >= 0; sy--) {
            const blockIndex = (sy << 8) | (z << 4) | x;
            const blockName = getBlockName(sec, blockIndex);
            const absY = sec.y * 16 + sy;

            if (AIR_BLOCKS.has(blockName)) continue;

            if (TRANSPARENT_WATER.has(blockName)) {
              if (waterSurfaceY === -9999) waterSurfaceY = absY;
              continue;
            }

            // Found a solid block (or lava)
            solidY = absY;
            const color = getBlockColor(blockName);
            const idx = colIdx * 4;
            result.pixels[idx] = color[0];
            result.pixels[idx + 1] = color[1];
            result.pixels[idx + 2] = color[2];
            result.pixels[idx + 3] = color[3];

            if (waterSurfaceY !== -9999) {
              // Water above this solid block
              result.isWater[colIdx] = 1;
              result.waterDepth[colIdx] = Math.min(255, waterSurfaceY - absY);
              result.heights[colIdx] = waterSurfaceY;
            } else {
              result.heights[colIdx] = absY;
            }

            foundSolid = true;
            break;
          }
        }

        // If only water was found (ocean floor out of range), use water surface
        if (!foundSolid && waterSurfaceY !== -9999) {
          const color = getBlockColor('water');
          const idx = colIdx * 4;
          result.pixels[idx] = color[0];
          result.pixels[idx + 1] = color[1];
          result.pixels[idx + 2] = color[2];
          result.pixels[idx + 3] = color[3];
          result.isWater[colIdx] = 1;
          result.waterDepth[colIdx] = 255;
          result.heights[colIdx] = waterSurfaceY;
        }
      }
    }
  } catch (e: any) {
    console.error(`  Failed to parse chunk (${chunkX}, ${chunkZ}): ${e.message}`);
  }

  chunkCache.set(key, result);
  return result;
}

// Keep old API for compatibility
export async function loadChunkTopBlocks(
  worldPath: string,
  dimension: string,
  chunkX: number,
  chunkZ: number,
): Promise<Uint8Array> {
  const data = await loadChunkColumnData(worldPath, dimension, chunkX, chunkZ);
  return data.pixels;
}

export async function debugRawChunk(
  worldPath: string,
  dimension: string,
  chunkX: number,
  chunkZ: number,
): Promise<void> {
  const regionDir = getRegionDir(worldPath, dimension);
  const rx = regionCoord(chunkX);
  const rz = regionCoord(chunkZ);

  const regionPath = path.join(regionDir, `r.${rx}.${rz}.mca`);
  console.log(`  [raw-debug] Region file: ${regionPath}`);

  const regionBuf = getRegionBuffer(regionPath);
  if (!regionBuf) {
    console.log(`  [raw-debug] Region file not found or empty`);
    return;
  }

  const localX = ((chunkX % 32) + 32) % 32;
  const localZ = ((chunkZ % 32) + 32) % 32;
  console.log(`  [raw-debug] Chunk (${chunkX},${chunkZ}) -> region (${rx},${rz}), local (${localX},${localZ})`);

  const nbtData = decompressChunkData(regionBuf, localX, localZ);
  if (!nbtData) {
    console.log(`  [raw-debug] Chunk not found in region (not generated?)`);
    return;
  }

  console.log(`  [raw-debug] Decompressed NBT size: ${nbtData.length} bytes`);

  try {
    const data = await loadChunkColumnData(worldPath, dimension, chunkX, chunkZ);
    let nonTransparent = 0;
    let waterCols = 0;
    for (let i = 0; i < 256; i++) {
      if (data.pixels[i * 4 + 3] > 0) nonTransparent++;
      if (data.isWater[i]) waterCols++;
    }
    console.log(`  [raw-debug]   Top-block result: ${nonTransparent}/256 non-transparent, ${waterCols} water columns`);
  } catch (e: any) {
    console.log(`  [raw-debug] Parse error: ${e.message}`);
  }
}
