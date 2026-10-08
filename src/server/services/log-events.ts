import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import readline from 'readline';
import { config } from '../config.js';

/**
 * Events picked out of a Paper or Velocity log folder. Rolled
 * `YYYY-MM-DD-N.log.gz` files never change, so each is read once and its
 * events cached; `latest.log` is read again on every load.
 */

/** [time, kind, ...fields] — tuples keep the per-file caches small */
export type LogEvent = [number, string, ...string[]];

/** Turns a log message (the text after the `]: ` prefix) into [kind, ...fields], or null */
export type LogMatcher = (message: string) => [string, ...string[]] | null;

/** `[HH:MM:SS] [thread/LEVEL]: msg` (Paper) or `[HH:MM:SS] [thread/LEVEL] [logger]: msg` (Velocity) */
const LINE = /^\[(\d\d):(\d\d):(\d\d)\] .*?\]: (.*)$/;
const ROLLED = /^(\d{4})-(\d\d)-(\d\d)-(\d+)\.log\.gz$/;

/**
 * All matched events in time order, or null when the folder is missing or
 * empty. `cacheKey` names the matcher: change it whenever the matcher changes.
 */
export async function loadLogEvents(dir: string, cacheKey: string, match: LogMatcher): Promise<LogEvent[] | null> {
  if (!fs.existsSync(dir)) return null;

  const rolled = fs.readdirSync(dir)
    .map((name) => ({ name, m: ROLLED.exec(name) }))
    .filter((f): f is { name: string; m: RegExpExecArray } => f.m !== null)
    .sort((a, b) => a.name.slice(0, 10).localeCompare(b.name.slice(0, 10)) || Number(a.m[4]) - Number(b.m[4]));

  const cacheDir = path.join(config.cacheDir, 'log-events', cacheKey);
  fs.mkdirSync(cacheDir, { recursive: true });
  const events: LogEvent[] = [];
  for (const { name, m } of rolled) {
    const cacheFile = path.join(cacheDir, `${name}.json`);
    let fileEvents: LogEvent[];
    try {
      fileEvents = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    } catch {
      fileEvents = await readFile(path.join(dir, name), new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), match);
      fs.writeFileSync(cacheFile, JSON.stringify(fileEvents));
    }
    events.push(...fileEvents);
  }

  // latest.log rolls at midnight, so its lines all belong to the day of its last write
  const latest = path.join(dir, 'latest.log');
  if (fs.existsSync(latest)) {
    const mtime = fs.statSync(latest).mtime;
    events.push(...await readFile(latest, new Date(mtime.getFullYear(), mtime.getMonth(), mtime.getDate()), match));
  }

  return events.length > 0 ? events : null;
}

async function readFile(file: string, day: Date, match: LogMatcher): Promise<LogEvent[]> {
  const events: LogEvent[] = [];
  const y = day.getFullYear(), mo = day.getMonth(), d = day.getDate();
  const raw = fs.createReadStream(file);
  const input = file.endsWith('.gz') ? raw.pipe(zlib.createGunzip()) : raw;
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  // pipe() does not forward errors, and readline does not surface them: end the read instead
  raw.on('error', () => lines.close());
  input.on('error', () => lines.close());
  try {
    for await (const line of lines) {
      const m = LINE.exec(line);
      if (!m) continue;
      const hit = match(m[4]);
      if (hit) events.push([new Date(y, mo, d, Number(m[1]), Number(m[2]), Number(m[3])).getTime(), ...hit]);
    }
  } catch {
    // A truncated .gz still yields the events read before the damage
  }
  return events;
}
