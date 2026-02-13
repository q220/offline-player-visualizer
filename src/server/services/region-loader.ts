import fs from 'fs';
import path from 'path';
import { LRUCache } from 'lru-cache';
import { getRegionDir } from './world-scanner.js';

let AnvilClass: any;

export async function initAnvil(mcVersion: string): Promise<void> {
  if (AnvilClass) return;
  // prismarine-provider-anvil exports { Anvil: (version) => class Anvil }
  const mod = await import('prismarine-provider-anvil');
  const factory = (mod as any).default?.Anvil || (mod as any).Anvil;
  // Use latest supported version as fallback for unknown or unsupported versions
  const latestSupported = (mod as any).default?.latestSupportedVersion || (mod as any).latestSupportedVersion || '1.21.1';
  let version = mcVersion;
  if (version === 'unknown') {
    version = latestSupported;
  } else {
    // Check if the version is supported; if not, fall back to latest supported
    const tested = (mod as any).default?.testedVersions || (mod as any).testedVersions || [];
    if (!tested.includes(version)) {
      console.log(`  MC version ${version} not supported by prismarine, falling back to ${latestSupported}`);
      version = latestSupported;
    }
  }
  AnvilClass = factory(version);
}

const chunkCache = new LRUCache<string, any>({ max: 500 });

export async function loadChunk(
  worldPath: string,
  dimension: string,
  chunkX: number,
  chunkZ: number,
): Promise<any | null> {
  const key = `${dimension}:${chunkX}:${chunkZ}`;
  const cached = chunkCache.get(key);
  if (cached !== undefined) return cached;

  const regionDir = getRegionDir(worldPath, dimension);
  if (!fs.existsSync(regionDir)) return null;

  try {
    const anvil = new AnvilClass(regionDir);
    const chunk = await anvil.load(chunkX, chunkZ);
    chunkCache.set(key, chunk);
    return chunk;
  } catch {
    chunkCache.set(key, null);
    return null;
  }
}

export function listRegionFiles(worldPath: string, dimension: string): string[] {
  const regionDir = getRegionDir(worldPath, dimension);
  if (!fs.existsSync(regionDir)) return [];

  return fs
    .readdirSync(regionDir)
    .filter((f) => f.endsWith('.mca'))
    .map((f) => path.join(regionDir, f));
}

export function parseRegionCoords(filename: string): { rx: number; rz: number } | null {
  const match = path.basename(filename).match(/^r\.(-?\d+)\.(-?\d+)\.mca$/);
  if (!match) return null;
  return { rx: parseInt(match[1]), rz: parseInt(match[2]) };
}

/**
 * Count populated chunks in a region file by reading the 4KB header.
 * Each .mca header has 1024 4-byte entries; non-zero = chunk exists.
 * This is very fast — no chunk data is read.
 */
export function countRegionChunks(filepath: string): number {
  try {
    const fd = fs.openSync(filepath, 'r');
    const header = Buffer.alloc(4096);
    fs.readSync(fd, header, 0, 4096, 0);
    fs.closeSync(fd);

    let count = 0;
    for (let i = 0; i < 1024; i++) {
      // Each entry is 4 bytes: 3 bytes offset + 1 byte sector count
      // If the offset (first 3 bytes) is non-zero, the chunk exists
      if (header[i * 4] !== 0 || header[i * 4 + 1] !== 0 || header[i * 4 + 2] !== 0) {
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

export interface RegionInfo {
  rx: number;
  rz: number;
  chunks: number;
  filepath: string;
}

/**
 * Scan all region files for a dimension and return info sorted by chunk count.
 */
export function scanRegions(worldPath: string, dimension: string): RegionInfo[] {
  const files = listRegionFiles(worldPath, dimension);
  const regions: RegionInfo[] = [];

  for (const f of files) {
    const coords = parseRegionCoords(f);
    if (!coords) continue;
    const chunks = countRegionChunks(f);
    if (chunks > 0) {
      regions.push({ ...coords, chunks, filepath: f });
    }
  }

  return regions;
}
