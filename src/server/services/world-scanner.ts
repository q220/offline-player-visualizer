import fs from 'fs';
import path from 'path';
import { parse } from 'prismarine-nbt';
import type { WorldInfo } from '../../shared/protocol.js';
import { DEFAULT_BOUNDS, DIMENSIONS } from '../../shared/constants.js';

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
      const buffer = fs.readFileSync(levelDatPath);
      const { parsed } = await parse(buffer);
      const data = parsed.value.Data?.value as any;
      if (data) {
        name = data.LevelName?.value || name;
        mcVersion = data.Version?.value?.Name?.value || 'unknown';
        const spawnX = data.SpawnX?.value;
        const spawnZ = data.SpawnZ?.value;
        if (typeof spawnX === 'number' && typeof spawnZ === 'number') {
          spawn = { x: spawnX, z: spawnZ };
        }
      }
    } catch (e) {
      console.warn('Failed to parse level.dat:', e);
    }
  }

  // Discover dimensions
  const dimensions: string[] = [];

  // Check overworld (region folder directly in world)
  const overworldRegion = path.join(absPath, 'region');
  if (fs.existsSync(overworldRegion) && hasRegionFiles(overworldRegion)) {
    dimensions.push('minecraft:overworld');
  }

  // Check nether
  const netherRegion = path.join(absPath, 'DIM-1', 'region');
  if (fs.existsSync(netherRegion) && hasRegionFiles(netherRegion)) {
    dimensions.push('minecraft:the_nether');
  }

  // Check end
  const endRegion = path.join(absPath, 'DIM1', 'region');
  if (fs.existsSync(endRegion) && hasRegionFiles(endRegion)) {
    dimensions.push('minecraft:the_end');
  }

  // Count playerdata files
  const playerDataDir = path.join(absPath, 'playerdata');
  let playerCount = 0;
  if (fs.existsSync(playerDataDir)) {
    const files = fs.readdirSync(playerDataDir);
    playerCount = files.filter((f) => f.endsWith('.dat')).length;
  }

  return {
    name,
    mcVersion,
    dimensions: dimensions.length > 0 ? dimensions : [DIMENSIONS[0]],
    playerCount,
    bounds: { ...DEFAULT_BOUNDS },
    spawn,
  };
}

function hasRegionFiles(dir: string): boolean {
  try {
    const files = fs.readdirSync(dir);
    return files.some((f) => f.endsWith('.mca'));
  } catch {
    return false;
  }
}

export function getRegionDir(worldPath: string, dimension: string): string {
  const absPath = path.resolve(worldPath);
  switch (dimension) {
    case 'minecraft:overworld':
      return path.join(absPath, 'region');
    case 'minecraft:the_nether':
      return path.join(absPath, 'DIM-1', 'region');
    case 'minecraft:the_end':
      return path.join(absPath, 'DIM1', 'region');
    default: {
      // Custom dimensions: check world/dimensions/namespace/name/region/
      const dimName = dimension.replace('minecraft:', '');
      const customPath = path.join(absPath, 'dimensions', 'minecraft', dimName, 'region');
      if (fs.existsSync(customPath)) return customPath;
      // Fallback: check for Bukkit-style world_dimname/region/ in parent
      const parentDir = path.dirname(absPath);
      const worldName = path.basename(absPath);
      const bukkitPath = path.join(parentDir, `${worldName}_${dimName}`, 'region');
      if (fs.existsSync(bukkitPath)) return bukkitPath;
      // Last resort: return the custom path even if it doesn't exist
      return customPath;
    }
  }
}
