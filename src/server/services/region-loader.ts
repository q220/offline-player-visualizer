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
 * Read the 4KB MCA header and return a 1024-element boolean mask.
 * mask[localX + localZ * 32] = true if the chunk exists.
 * Each header entry is 4 bytes: 3 bytes offset + 1 byte sector count.
 */
export function getRegionChunkMask(filepath: string): boolean[] {
  const mask = new Array<boolean>(1024).fill(false);
  try {
    const fd = fs.openSync(filepath, 'r');
    const header = Buffer.alloc(4096);
    fs.readSync(fd, header, 0, 4096, 0);
    fs.closeSync(fd);

    for (let i = 0; i < 1024; i++) {
      if (header[i * 4] !== 0 || header[i * 4 + 1] !== 0 || header[i * 4 + 2] !== 0) {
        mask[i] = true;
      }
    }
  } catch {
    // Return all-false mask on error
  }
  return mask;
}

/**
 * Count populated chunks in a region file by reading the 4KB header.
 * This is very fast — no chunk data is read.
 */
export function countRegionChunks(filepath: string): number {
  const mask = getRegionChunkMask(filepath);
  let count = 0;
  for (let i = 0; i < 1024; i++) {
    if (mask[i]) count++;
  }
  return count;
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

interface RegionEntry {
  info: RegionInfo;
  mask: boolean[];
}

/**
 * Check if two adjacent regions share chunk connectivity at their border.
 * Returns true if ANY chunk on the shared edge exists in both regions.
 */
function areRegionsConnected(
  a: RegionEntry,
  b: RegionEntry,
  dx: number,
  dz: number,
): boolean {
  // dx=1 means B is east of A: check A's localX=31 vs B's localX=0
  // dx=-1 means B is west of A: check A's localX=0 vs B's localX=31
  // dz=1 means B is south of A: check A's localZ=31 vs B's localZ=0
  // dz=-1 means B is north of A: check A's localZ=0 vs B's localZ=31

  if (dx !== 0) {
    const aCol = dx > 0 ? 31 : 0;
    const bCol = dx > 0 ? 0 : 31;
    for (let z = 0; z < 32; z++) {
      if (a.mask[aCol + z * 32] && b.mask[bCol + z * 32]) {
        return true;
      }
    }
  } else {
    const aRow = dz > 0 ? 31 : 0;
    const bRow = dz > 0 ? 0 : 31;
    for (let x = 0; x < 32; x++) {
      if (a.mask[x + aRow * 32] && b.mask[x + bRow * 32]) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Find all regions connected to spawn via chunk-level adjacency (BFS flood-fill).
 * This excludes buggy/orphaned region files that Minecraft generated far from the world.
 *
 * Algorithm:
 * 1. Read chunk masks for all region files
 * 2. Start BFS from the region containing (spawnX, spawnZ)
 * 3. For each neighbor: check if chunks on the shared border actually touch
 * 4. Return only connected regions
 */
export function findConnectedRegions(
  worldPath: string,
  dimension: string,
  spawnX: number,
  spawnZ: number,
): RegionInfo[] {
  const files = listRegionFiles(worldPath, dimension);
  if (files.length === 0) return [];

  // Build map of all regions with their chunk masks
  const regionMap = new Map<string, RegionEntry>();
  for (const f of files) {
    const coords = parseRegionCoords(f);
    if (!coords) continue;
    const mask = getRegionChunkMask(f);
    const chunks = mask.filter(Boolean).length;
    if (chunks === 0) continue;

    const key = `${coords.rx},${coords.rz}`;
    regionMap.set(key, {
      info: { ...coords, chunks, filepath: f },
      mask,
    });
  }

  if (regionMap.size === 0) return [];

  // Find starting region
  const spawnRx = Math.floor(spawnX / 512);
  const spawnRz = Math.floor(spawnZ / 512);
  let startKey = `${spawnRx},${spawnRz}`;

  // If spawn region doesn't exist, find the nearest region with chunks
  if (!regionMap.has(startKey)) {
    let bestDist = Infinity;
    for (const [key, entry] of regionMap) {
      const dx = entry.info.rx - spawnRx;
      const dz = entry.info.rz - spawnRz;
      const dist = dx * dx + dz * dz;
      if (dist < bestDist) {
        bestDist = dist;
        startKey = key;
      }
    }
  }

  // BFS flood-fill
  const visited = new Set<string>();
  const queue: string[] = [startKey];
  visited.add(startKey);

  const directions = [
    { dx: 1, dz: 0 },   // east
    { dx: -1, dz: 0 },  // west
    { dx: 0, dz: 1 },   // south
    { dx: 0, dz: -1 },  // north
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const entry = regionMap.get(current)!;

    for (const { dx, dz } of directions) {
      const neighborKey = `${entry.info.rx + dx},${entry.info.rz + dz}`;
      if (visited.has(neighborKey)) continue;

      const neighbor = regionMap.get(neighborKey);
      if (!neighbor) continue;

      if (areRegionsConnected(entry, neighbor, dx, dz)) {
        visited.add(neighborKey);
        queue.push(neighborKey);
      }
    }
  }

  // Collect connected regions
  const connected: RegionInfo[] = [];
  const disconnected: RegionInfo[] = [];
  for (const [key, entry] of regionMap) {
    if (visited.has(key)) {
      connected.push(entry.info);
    } else {
      disconnected.push(entry.info);
    }
  }

  // Log results
  const connectedChunks = connected.reduce((s, r) => s + r.chunks, 0);
  console.log(`  Flood-fill from r.${spawnRx}.${spawnRz}: ${connected.length} connected regions (${connectedChunks} chunks)`);
  if (disconnected.length > 0) {
    const discChunks = disconnected.reduce((s, r) => s + r.chunks, 0);
    const examples = disconnected
      .sort((a, b) => b.chunks - a.chunks)
      .slice(0, 5)
      .map(r => `r.${r.rx}.${r.rz}=${r.chunks}`)
      .join(', ');
    console.log(`  Excluded ${disconnected.length} disconnected regions (${discChunks} chunks): ${examples}`);
  }

  return connected;
}
