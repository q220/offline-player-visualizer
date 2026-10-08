import fs from 'fs';
import path from 'path';
import nbt from 'prismarine-nbt';
import type { PlayerRecord } from '../../shared/protocol.js';
import { getPlayerDataDir } from './world-scanner.js';

/** Files read and parsed at once; file I/O and gunzip run on the libuv pool */
const PARSE_CONCURRENCY = 32;
const PROGRESS_EVERY = 2000;

interface IndexProgress {
  total: number;
  processed: number;
  percent: number;
}

type ProgressCallback = (progress: IndexProgress) => void;

export interface IndexResult {
  players: PlayerRecord[];
  /** Files parsed this run (new or changed since the cache) */
  parsed: number;
  /** Records reused from the cache because the file mtime was unchanged */
  reused: number;
  failed: number;
}

/**
 * Index all player files. A record in `previous` is reused when its file's
 * mtime is unchanged, so after the first run only re-saved files are parsed.
 */
export async function indexPlayers(
  worldPath: string,
  previous: Map<string, PlayerRecord>,
  onProgress?: ProgressCallback,
): Promise<IndexResult> {
  const result: IndexResult = { players: [], parsed: 0, reused: 0, failed: 0 };
  const absPath = path.resolve(worldPath);
  const playerDataDir = getPlayerDataDir(absPath);

  if (!playerDataDir) {
    console.warn('No player data directory found (players/data or playerdata)');
    return result;
  }

  // Fallback for files without bukkit.lastKnownName (non-Paper worlds)
  const nameMap = loadUsercache(absPath);

  const files = fs.readdirSync(playerDataDir).filter((f) => f.endsWith('.dat'));
  const total = files.length;
  console.log(`Found ${total} player data files in ${playerDataDir}`);

  let next = 0;
  let processed = 0;

  async function worker(): Promise<void> {
    while (next < total) {
      const file = files[next++];
      const uuid = path.basename(file, '.dat');
      const filePath = path.join(playerDataDir!, file);

      try {
        const { mtimeMs } = await fs.promises.stat(filePath);
        const cached = previous.get(uuid);
        let record: PlayerRecord | null;
        if (cached && cached.lastModified === mtimeMs) {
          record = cached;
          result.reused++;
        } else {
          record = await parsePlayerFile(filePath, uuid, mtimeMs);
          result.parsed++;
        }
        if (record) {
          record.name ??= nameMap.get(uuid);
          result.players.push(record);
        }
      } catch {
        // Corrupt, or removed while indexing
        result.failed++;
      }

      processed++;
      if (processed % PROGRESS_EVERY === 0 || processed === total) {
        onProgress?.({ total, processed, percent: Math.round((processed / total) * 100) });
      }
    }
  }

  await Promise.all(Array.from({ length: PARSE_CONCURRENCY }, worker));
  return result;
}

async function parsePlayerFile(
  filePath: string,
  uuid: string,
  mtimeMs: number,
): Promise<PlayerRecord | null> {
  const { parsed } = await nbt.parse(await fs.promises.readFile(filePath));
  const root = parsed.value as any;

  const pos = root.Pos?.value?.value;
  if (!pos || pos.length < 3) return null;

  const bukkit = root.bukkit?.value;
  const paper = root.Paper?.value;

  return {
    uuid,
    name: bukkit?.lastKnownName?.value,
    x: pos[0],
    y: pos[1],
    z: pos[2],
    dimension: parseDimension(root.Dimension?.value),
    lastModified: mtimeMs,
    firstJoined: toTimestamp(bukkit?.firstPlayed?.value),
    lastOnline: toTimestamp(bukkit?.lastPlayed?.value) ?? toTimestamp(paper?.LastSeen?.value),
    hasHeadItem: hasHeadItem(root),
  };
}

function parseDimension(value: unknown): string {
  if (typeof value === 'string') return value;
  // Pre-1.16 numeric ids
  switch (value) {
    case -1:
      return 'minecraft:the_nether';
    case 1:
      return 'minecraft:the_end';
    default:
      return 'minecraft:overworld';
  }
}

/** The head slot is equipment.head since 1.21.5, Inventory slot 103 before */
function hasHeadItem(root: any): boolean {
  if (root.equipment?.value?.head) return true;
  const inventory = root.Inventory?.value?.value;
  return Array.isArray(inventory) && inventory.some((item: any) => item.Slot?.value === 103);
}

/** prismarine-nbt gives a long as [high, low] signed 32-bit halves */
function toTimestamp(val: unknown): number | undefined {
  let ms: number | undefined;
  if (typeof val === 'number') ms = val;
  else if (typeof val === 'bigint') ms = Number(val);
  else if (Array.isArray(val) && val.length === 2) {
    ms = Number((BigInt(val[0]) << 32n) | BigInt(val[1] >>> 0));
  }
  return ms !== undefined && ms > 0 ? ms : undefined;
}

function loadUsercache(worldPath: string): Map<string, string> {
  // Usually in the server root, next to the world folder
  for (const file of [path.join(worldPath, 'usercache.json'), path.join(path.dirname(worldPath), 'usercache.json')]) {
    if (fs.existsSync(file)) return parseUsercache(file);
  }
  console.warn('No usercache.json found');
  return new Map();
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
