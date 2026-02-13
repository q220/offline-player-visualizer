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
  // Use latest supported version as fallback if unknown
  const version = mcVersion === 'unknown'
    ? (mod as any).default?.latestSupportedVersion || (mod as any).latestSupportedVersion || '1.20.4'
    : mcVersion;
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
