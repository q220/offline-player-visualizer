import fs from 'fs';
import path from 'path';
import type { PlayerRecord } from '../../shared/protocol.js';
import { config } from '../config.js';

interface IndexProgress {
  total: number;
  processed: number;
  percent: number;
}

type ProgressCallback = (progress: IndexProgress) => void;

export async function indexPlayers(
  worldPath: string,
  onProgress?: ProgressCallback,
): Promise<PlayerRecord[]> {
  const absPath = path.resolve(worldPath);
  const playerDataDir = path.join(absPath, 'playerdata');

  if (!fs.existsSync(playerDataDir)) {
    console.warn('No playerdata directory found');
    return [];
  }

  // Load usercache for name resolution
  const nameMap = loadUsercache(absPath);

  // Get all .dat files
  const allFiles = fs
    .readdirSync(playerDataDir)
    .filter((f) => f.endsWith('.dat'))
    .map((f) => path.join(playerDataDir, f));

  const total = allFiles.length;
  console.log(`Found ${total} player data files`);

  if (total === 0) return [];

  // Split into batches
  const { batchSize } = config.playerIndexing;
  const batches: string[][] = [];
  for (let i = 0; i < allFiles.length; i += batchSize) {
    batches.push(allFiles.slice(i, i + batchSize));
  }

  // Process batches inline (prismarine-nbt parse is async but fast)
  let processed = 0;
  const allPlayers: PlayerRecord[] = [];
  const { parse } = await import('prismarine-nbt');

  for (const batch of batches) {
    const batchResults = await parseBatch(batch, parse);

    for (const p of batchResults) {
      const name = nameMap.get(p.uuid);
      if (name) p.name = name;
    }

    allPlayers.push(...batchResults);
    processed += batch.length;

    onProgress?.({
      total,
      processed: Math.min(processed, total),
      percent: Math.round((Math.min(processed, total) / total) * 100),
    });
  }

  console.log(`Indexed ${allPlayers.length} players`);
  return allPlayers;
}

async function parseBatch(
  files: string[],
  parse: (buffer: Buffer) => Promise<{ parsed: any; type: string }>,
): Promise<PlayerRecord[]> {
  const results: PlayerRecord[] = [];

  for (const filePath of files) {
    try {
      const buffer = fs.readFileSync(filePath);
      const stat = fs.statSync(filePath);
      const { parsed } = await parse(buffer);
      const root = parsed.value as any;

      // Extract position
      const pos = root.Pos?.value?.value;
      if (!pos || pos.length < 3) continue;

      const x = pos[0];
      const y = pos[1];
      const z = pos[2];

      // Extract dimension
      let dimension = root.Dimension?.value;
      if (typeof dimension === 'number') {
        switch (dimension) {
          case -1:
            dimension = 'minecraft:the_nether';
            break;
          case 1:
            dimension = 'minecraft:the_end';
            break;
          default:
            dimension = 'minecraft:overworld';
        }
      } else if (typeof dimension !== 'string') {
        dimension = 'minecraft:overworld';
      }

      // UUID from filename
      const uuid = path.basename(filePath, '.dat');

      results.push({
        uuid,
        x,
        y,
        z,
        dimension,
        lastModified: stat.mtimeMs,
      });
    } catch {
      // Skip corrupt files
    }
  }

  return results;
}

function loadUsercache(worldPath: string): Map<string, string> {
  const nameMap = new Map<string, string>();
  const cacheFile = path.join(worldPath, 'usercache.json');

  if (!fs.existsSync(cacheFile)) {
    // Try parent dir (server root vs world folder)
    const parentCache = path.join(path.dirname(worldPath), 'usercache.json');
    if (fs.existsSync(parentCache)) {
      return parseUsercache(parentCache);
    }
    console.warn('No usercache.json found, names will not be resolved');
    return nameMap;
  }

  return parseUsercache(cacheFile);
}

function parseUsercache(filePath: string): Map<string, string> {
  const nameMap = new Map<string, string>();
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (Array.isArray(data)) {
      for (const entry of data) {
        if (entry.uuid && entry.name) {
          nameMap.set(entry.uuid, entry.name);
        }
      }
    }
    console.log(`Loaded ${nameMap.size} names from usercache.json`);
  } catch (e) {
    console.warn('Failed to parse usercache.json:', e);
  }
  return nameMap;
}
