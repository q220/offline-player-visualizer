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

// Cache parsed chunk top-block data
const chunkCache = new LRUCache<string, Uint8Array>({ max: 500 });

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
  // Offset table: first 4KB, 4 bytes per chunk (32x32 = 1024 entries)
  const offsetIndex = (localX + localZ * 32) * 4;
  if (offsetIndex + 4 > regionBuf.length) return null;

  const offsetVal = regionBuf.readUInt32BE(offsetIndex);
  if (offsetVal === 0) return null; // Chunk not generated

  const sectorNumber = offsetVal >> 8;
  const byteOffset = sectorNumber * 4096;

  if (byteOffset + 5 > regionBuf.length) return null;

  const dataLength = regionBuf.readUInt32BE(byteOffset) - 1;
  const compressionType = regionBuf.readUInt8(byteOffset + 4);

  if (dataLength <= 0 || byteOffset + 5 + dataLength > regionBuf.length) return null;

  const compressedData = regionBuf.subarray(byteOffset + 5, byteOffset + 5 + dataLength);

  if (compressionType === 2) {
    // zlib
    return zlib.inflateSync(compressedData);
  } else if (compressionType === 1) {
    // gzip
    return zlib.gunzipSync(compressedData);
  }

  return null;
}

/** Extract palette index from packed long array (MC 1.16+ format) */
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

/** Convert raw long array to BigInt array */
function toLongArray(rawData: any): bigint[] {
  if (!rawData) return [];

  // prismarine-nbt returns long arrays as arrays of [high, low] pairs
  if (Array.isArray(rawData)) {
    return rawData.map((pair: any) => {
      if (Array.isArray(pair) && pair.length === 2) {
        // [high, low] pair
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
  palette: string[]; // Block names without minecraft: prefix
  data: bigint[];
  bitsPerEntry: number;
}

const AIR_BLOCKS = new Set(['air', 'cave_air', 'void_air', '']);

async function parseSectionsFromNBT(nbtData: Buffer): Promise<{ sections: SectionData[]; minY: number }> {
  const { parsed } = await parseNBT(nbtData);
  const root = simplifyNBT(parsed);

  const sections: SectionData[] = [];
  let minY = -64;

  // Modern format (1.18+): sections are at root level
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

    // Extract block names from palette
    const blockNames: string[] = palette.map((entry: any) => {
      const name = entry.Name || entry.name || '';
      return name.replace('minecraft:', '');
    });

    // If palette has only 1 entry (SingleValueContainer), no data array needed
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

  // Sort sections by Y descending (so we scan top-down)
  sections.sort((a, b) => b.y - a.y);

  return { sections, minY };
}

/** Compute region coordinates that round toward negative infinity */
function regionCoord(chunkCoord: number): number {
  return Math.floor(chunkCoord / 32);
}

/**
 * Load a chunk from a raw .mca file and extract top-block colors.
 * Returns a 16x16x4 Uint8Array of RGBA pixels.
 */
export async function loadChunkTopBlocks(
  worldPath: string,
  dimension: string,
  chunkX: number,
  chunkZ: number,
): Promise<Uint8Array> {
  const key = `raw:${dimension}:${chunkX}:${chunkZ}`;
  const cached = chunkCache.get(key);
  if (cached !== undefined) return cached;

  const pixels = new Uint8Array(16 * 16 * 4);

  const regionDir = getRegionDir(worldPath, dimension);
  const rx = regionCoord(chunkX);
  const rz = regionCoord(chunkZ);

  const regionPath = path.join(regionDir, `r.${rx}.${rz}.mca`);
  const regionBuf = getRegionBuffer(regionPath);
  if (!regionBuf) {
    chunkCache.set(key, pixels);
    return pixels;
  }

  // Local chunk coords within region (0-31)
  const localX = ((chunkX % 32) + 32) % 32;
  const localZ = ((chunkZ % 32) + 32) % 32;

  const nbtData = decompressChunkData(regionBuf, localX, localZ);
  if (!nbtData) {
    chunkCache.set(key, pixels);
    return pixels;
  }

  try {
    const { sections } = await parseSectionsFromNBT(nbtData);

    // For each column (x, z), find the topmost non-air block
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        let found = false;

        // Sections are sorted top-down
        for (const sec of sections) {
          if (found) break;

          // Scan Y from top (15) to bottom (0) within section
          for (let sy = 15; sy >= 0; sy--) {
            const blockIndex = (sy << 8) | (z << 4) | x;

            let blockName: string;
            if (sec.bitsPerEntry === 0) {
              // SingleValueContainer - entire section is one block type
              blockName = sec.palette[0] || '';
            } else {
              const paletteIdx = extractPaletteIndex(sec.data, blockIndex, sec.bitsPerEntry);
              blockName = sec.palette[paletteIdx] || '';
            }

            if (!AIR_BLOCKS.has(blockName)) {
              const color = getBlockColor(blockName);
              const idx = (z * 16 + x) * 4;
              pixels[idx] = color[0];
              pixels[idx + 1] = color[1];
              pixels[idx + 2] = color[2];
              pixels[idx + 3] = color[3];
              found = true;
              break;
            }
          }
        }
      }
    }
  } catch (e: any) {
    console.error(`  Failed to parse chunk (${chunkX}, ${chunkZ}): ${e.message}`);
  }

  chunkCache.set(key, pixels);
  return pixels;
}

/**
 * Debug: load and inspect a single chunk's raw NBT data.
 */
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

  // Also dump the raw NBT keys at root level for format verification
  try {
    const { parsed } = await parseNBT(nbtData);
    const root = simplifyNBT(parsed);
    const rootKeys = Object.keys(root);
    console.log(`  [raw-debug] Root NBT keys: ${rootKeys.join(', ')}`);
    if (root.Status || root.status) {
      console.log(`  [raw-debug] Chunk status: ${root.Status || root.status}`);
    }
    if (root.DataVersion) {
      console.log(`  [raw-debug] DataVersion: ${root.DataVersion}`);
    }
  } catch (e: any) {
    console.log(`  [raw-debug] Failed to dump root keys: ${e.message}`);
  }

  try {
    const { sections, minY } = await parseSectionsFromNBT(nbtData);
    console.log(`  [raw-debug] minY=${minY}, ${sections.length} sections parsed`);

    let nonAirSections = 0;
    for (const sec of sections) {
      const isAirOnly = sec.palette.length === 1 && AIR_BLOCKS.has(sec.palette[0]);
      if (!isAirOnly) {
        nonAirSections++;
        console.log(`  [raw-debug]   Section Y=${sec.y}: palette(${sec.palette.length})=[${sec.palette.slice(0, 8).join(', ')}${sec.palette.length > 8 ? '...' : ''}], bitsPerEntry=${sec.bitsPerEntry}, dataLen=${sec.data.length}`);
      }
    }
    console.log(`  [raw-debug]   ${nonAirSections} non-air sections, ${sections.length - nonAirSections} air-only sections`);

    // Try extracting top blocks for this chunk
    const topBlocks = await loadChunkTopBlocks(worldPath, dimension, chunkX, chunkZ);
    let nonTransparent = 0;
    for (let i = 3; i < topBlocks.length; i += 4) {
      if (topBlocks[i] > 0) nonTransparent++;
    }
    console.log(`  [raw-debug]   Top-block result: ${nonTransparent}/256 non-transparent pixels`);
  } catch (e: any) {
    console.log(`  [raw-debug] Parse error: ${e.message}`);
    console.log(`  [raw-debug] Stack: ${e.stack}`);
  }
}
