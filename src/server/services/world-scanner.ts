import fs from 'fs';
import path from 'path';
import nbt from 'prismarine-nbt';
import type { WorldInfo } from '../../shared/protocol.js';
import { DEFAULT_BOUNDS } from '../../shared/constants.js';

/** Pre-26.1 locations of the vanilla dimensions, relative to the world folder */
const LEGACY_REGION_DIRS: Record<string, string> = {
  'minecraft:overworld': 'region',
  'minecraft:the_nether': path.join('DIM-1', 'region'),
  'minecraft:the_end': path.join('DIM1', 'region'),
};

/** A namespace or path segment of a dimension id; rejects '.', '..' and separators */
const SAFE_SEGMENT = /^[a-z0-9_-][a-z0-9_.-]*$/;

export async function scanWorld(worldPath: string): Promise<WorldInfo> {
  const absPath = path.resolve(worldPath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`World path does not exist: ${absPath}`);
  }

  // Read level.dat
  let name = path.basename(absPath);
  let mcVersion = 'unknown';
  let spawn: { x: number; z: number } | undefined;

  const levelDatPath = path.join(absPath, 'level.dat');
  if (fs.existsSync(levelDatPath)) {
    try {
      const { parsed } = await nbt.parse(fs.readFileSync(levelDatPath));
      const data = (nbt.simplify(parsed) as any).Data;
      if (data) {
        name = data.LevelName || name;
        mcVersion = data.Version?.Name || 'unknown';
        // 26.1+: Data.spawn.pos = [x, y, z]; before: SpawnX / SpawnZ
        const pos = data.spawn?.pos;
        if (Array.isArray(pos) && pos.length === 3) {
          spawn = { x: pos[0], z: pos[2] };
        } else if (typeof data.SpawnX === 'number' && typeof data.SpawnZ === 'number') {
          spawn = { x: data.SpawnX, z: data.SpawnZ };
        }
      }
    } catch (e) {
      console.warn('Failed to parse level.dat:', e);
    }
  }

  const dimensions = discoverDimensions(absPath);

  const playerDataDir = getPlayerDataDir(absPath);
  const playerCount = playerDataDir
    ? fs.readdirSync(playerDataDir).filter((f) => f.endsWith('.dat')).length
    : 0;

  return {
    name,
    mcVersion,
    dimensions: dimensions.length > 0 ? dimensions : ['minecraft:overworld'],
    playerCount,
    bounds: { ...DEFAULT_BOUNDS },
    spawn,
  };
}

/** Dimensions that have region files, in both the 26.1+ and the legacy layout */
function discoverDimensions(absPath: string): string[] {
  const found = new Set<string>();

  // 26.1+ layout (and custom dimensions before it): dimensions/<namespace>/<name>/region
  const dimensionsRoot = path.join(absPath, 'dimensions');
  for (const ns of readdirOrEmpty(dimensionsRoot)) {
    for (const dimName of readdirOrEmpty(path.join(dimensionsRoot, ns))) {
      if (hasRegionFiles(path.join(dimensionsRoot, ns, dimName, 'region'))) {
        found.add(`${ns}:${dimName}`);
      }
    }
  }

  for (const [dim, rel] of Object.entries(LEGACY_REGION_DIRS)) {
    if (hasRegionFiles(path.join(absPath, rel))) found.add(dim);
  }

  return Array.from(found);
}

/** Player files moved from playerdata/ to players/data/ in 26.1 */
export function getPlayerDataDir(worldPath: string): string | null {
  const absPath = path.resolve(worldPath);
  for (const rel of [path.join('players', 'data'), 'playerdata']) {
    const dir = path.join(absPath, rel);
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

function readdirOrEmpty(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function hasRegionFiles(dir: string): boolean {
  return readdirOrEmpty(dir).some((f) => f.endsWith('.mca'));
}

const regionDirCache = new Map<string, string | null>();

/**
 * Locate a dimension's region folder, or null if the id is malformed or no
 * folder exists. Looks at the 26.1+ layout first, then the legacy vanilla
 * folders, then Paper/Bukkit sibling world folders for custom dimensions.
 */
export function getRegionDir(worldPath: string, dimension: string): string | null {
  const absPath = path.resolve(worldPath);
  const sep = dimension.indexOf(':');
  const ns = sep === -1 ? 'minecraft' : dimension.slice(0, sep);
  const dimName = dimension.slice(sep + 1);
  if (!SAFE_SEGMENT.test(ns) || !SAFE_SEGMENT.test(dimName)) return null;

  const key = `${absPath}\0${ns}:${dimName}`;
  const cached = regionDirCache.get(key);
  if (cached !== undefined) return cached;

  const candidates = [path.join(absPath, 'dimensions', ns, dimName, 'region')];
  const legacy = LEGACY_REGION_DIRS[`${ns}:${dimName}`];
  if (legacy) {
    candidates.push(path.join(absPath, legacy));
  } else {
    const parentDir = path.dirname(absPath);
    // Paper sibling world directory: ../dimname/region/
    candidates.push(path.join(parentDir, dimName, 'region'));
    // Bukkit-style: ../worldname_dimname/region/
    candidates.push(path.join(parentDir, `${path.basename(absPath)}_${dimName}`, 'region'));
  }

  const dir = candidates.find((c) => fs.existsSync(c)) ?? null;
  regionDirCache.set(key, dir);
  return dir;
}
