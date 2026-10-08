import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

/**
 * Each player's latest client protocol, from Plan's ViaVersion integration
 * (table `plan_version_protocol`). Plan keeps one row per player, so a player
 * who switched versions shows the last one they joined with.
 */

interface DbSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** PLAN_DB_* env, else Database.MySQL in Plan's config next to the world */
function dbSettings(worldPath: string): DbSettings | null {
  const env = process.env;
  if (env.PLAN_DB_USER) {
    return {
      host: env.PLAN_DB_HOST || '127.0.0.1',
      port: parseInt(env.PLAN_DB_PORT || '3306', 10),
      user: env.PLAN_DB_USER,
      password: env.PLAN_DB_PASSWORD || '',
      database: env.PLAN_DB_NAME || 'playeranalytics',
    };
  }

  const configFile = path.join(path.dirname(path.resolve(worldPath)), 'plugins', 'Plan', 'config.yml');
  if (!fs.existsSync(configFile)) return null;

  // Database: → Type: MySQL, and the keys of its MySQL: block (indented one level deeper)
  const values: Record<string, string> = {};
  let inDatabase = false;
  let type = '';
  for (const line of fs.readFileSync(configFile, 'utf-8').split('\n')) {
    if (/^\S/.test(line)) {
      inDatabase = /^Database:\s*$/.test(line);
      continue;
    }
    if (!inDatabase) continue;
    const m = line.match(/^\s+(Type|Host|Port|User|Password|Database):\s*(.*?)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (m[1] === 'Type') type = value;
    else values[m[1]] ??= value;
  }
  if (type.toLowerCase() !== 'mysql' || !values.User || !values.Database) return null;
  return {
    host: values.Host === 'localhost' ? '127.0.0.1' : values.Host || '127.0.0.1',
    port: parseInt(values.Port || '3306', 10),
    user: values.User,
    password: values.Password || '',
    database: values.Database,
  };
}

/** Protocol number by UUID, or null when Plan's database is not configured or not reachable */
export async function loadClientVersions(worldPath: string): Promise<Map<string, number> | null> {
  const settings = dbSettings(worldPath);
  if (!settings) return null;

  let conn: mysql.Connection | undefined;
  try {
    conn = await mysql.createConnection({ ...settings, connectTimeout: 10_000 });
    const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT uuid, protocol_version FROM plan_version_protocol');
    const versions = new Map<string, number>();
    for (const row of rows) {
      // Plan stores -1 when ViaVersion could not tell
      if (typeof row.uuid === 'string' && typeof row.protocol_version === 'number' && row.protocol_version > 0) {
        versions.set(row.uuid, row.protocol_version);
      }
    }
    return versions;
  } catch (e: any) {
    console.warn(`  Client versions unavailable: ${e.code || e.message}`);
    return null;
  } finally {
    await conn?.end().catch(() => {});
  }
}
