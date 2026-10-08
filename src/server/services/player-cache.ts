import fs from 'fs';
import path from 'path';
import type { PlayerRecord } from '../../shared/protocol.js';
import { PLAYER_CACHE_VERSION } from '../../shared/protocol.js';
import { config } from '../config.js';

export const playerCacheFile = path.join(config.cacheDir, 'players.json');

/** Cached player records by UUID; empty when missing or from an older format */
export function loadPlayerCache(): Map<string, PlayerRecord> {
  const players = new Map<string, PlayerRecord>();
  if (!fs.existsSync(playerCacheFile)) return players;

  try {
    const data = JSON.parse(fs.readFileSync(playerCacheFile, 'utf-8'));
    if (data?.version !== PLAYER_CACHE_VERSION || !Array.isArray(data.players)) {
      console.log('  Player cache is from an older version, will re-index everything');
      return players;
    }
    for (const p of data.players as PlayerRecord[]) players.set(p.uuid, p);
  } catch {
    console.warn('  Player cache is unreadable, will re-index everything');
  }
  return players;
}

export function savePlayerCache(players: PlayerRecord[]): void {
  fs.mkdirSync(config.cacheDir, { recursive: true });
  const tmp = `${playerCacheFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: PLAYER_CACHE_VERSION, players }));
  fs.renameSync(tmp, playerCacheFile);
}
