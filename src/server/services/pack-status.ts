import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import type { PackInfo, PackResult } from '../../shared/protocol.js';
import { topLevelSections } from './simple-yaml.js';

/**
 * Resource pack result per player from MCME-Architect's `architect_rp` table:
 * the last pack URL the network sent each player and what the client reported.
 * One row per player, network-wide and without a timestamp, so it tells the
 * latest pack a player got, not when.
 */

interface DbSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** ARCHITECT_DB_* env, else rpSettingsDatabase in Architect's config next to the world */
function dbSettings(worldPath: string): DbSettings | null {
  const env = process.env;
  if (env.ARCHITECT_DB_USER) {
    return {
      host: env.ARCHITECT_DB_HOST || '127.0.0.1',
      port: parseInt(env.ARCHITECT_DB_PORT || '3306', 10),
      user: env.ARCHITECT_DB_USER,
      password: env.ARCHITECT_DB_PASSWORD || '',
      database: env.ARCHITECT_DB_NAME || 'mcmegeneral',
    };
  }

  const configFile = path.join(path.dirname(path.resolve(worldPath)), 'plugins', 'MCME-Architect', 'config.yml');
  if (!fs.existsSync(configFile)) return null;
  const db = topLevelSections(fs.readFileSync(configFile, 'utf-8')).rpSettingsDatabase;
  if (!db?.user || !db.dbName) return null;
  return {
    host: db.ip === 'localhost' ? '127.0.0.1' : db.ip || '127.0.0.1',
    port: parseInt(db.port || '3306', 10),
    user: db.user,
    password: db.password || '',
    database: db.dbName,
  };
}

const RESULTS: Record<string, PackResult> = {
  SUCCESSFULLY_LOADED: 'loaded',
  FAILED_RELOAD: 'failed_reload',
  FAILED_DOWNLOAD: 'failed_download',
  INVALID_URL: 'failed_download',
  DECLINED: 'declined',
  DISCARDED: 'declined',
  ACCEPTED: 'no_result',
  DOWNLOADED: 'no_result',
  SENT: 'no_result',
};

/** github.com/<owner>/RP-<pack>/releases/download/<version>/<variant>.zip */
const RELEASE_URL = /github\.com\/[^/]+\/(?:RP-)?([^/]+)\/releases\/download\/([^/]+)\/([^/?#]+?)\.zip/;

export function parsePack(url: string | null, status: string | null): PackInfo {
  const result = (status && RESULTS[status]) || 'not_sent';
  const m = url ? RELEASE_URL.exec(url) : null;
  if (m) return { pack: m[1], version: m[2], variant: m[3], result };
  return { pack: url && url !== 'NULL' ? 'Other' : '', version: '', variant: '', result };
}

/** Pack info by UUID, or null when the database is not configured or not reachable */
export async function loadPackStatus(worldPath: string): Promise<Map<string, PackInfo> | null> {
  const settings = dbSettings(worldPath);
  if (!settings) return null;

  let conn: mysql.Connection | undefined;
  try {
    conn = await mysql.createConnection({ ...settings, connectTimeout: 10_000 });
    const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT uuid, currentURL, status FROM architect_rp');
    const packs = new Map<string, PackInfo>();
    for (const row of rows) {
      if (typeof row.uuid === 'string') packs.set(row.uuid, parsePack(row.currentURL, row.status));
    }
    return packs;
  } catch (e: any) {
    console.warn(`  Pack status unavailable: ${e.code || e.message}`);
    return null;
  } finally {
    await conn?.end().catch(() => {});
  }
}
