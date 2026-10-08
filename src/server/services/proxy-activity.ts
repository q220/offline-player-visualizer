import fs from 'fs';
import path from 'path';
import { loadLogEvents } from './log-events.js';

/**
 * Network-wide activity from the Velocity proxy's logs: when each player
 * connected, and which backend servers they went to. The proxy logs names,
 * not UUIDs, so activity is keyed by lower-cased name.
 */

export interface PlayerActivity {
  /** Connection times to the network */
  connects: number[];
  /** [time, server] for every backend server they connected to */
  servers: [number, string][];
}

export interface ProxyActivity {
  byName: Map<string, PlayerActivity>;
  coverageStart: number;
}

const CONNECT = /^\[connected player\] (\S+) \(\/[^)]*\) has connected$/;
const SERVER = /^\[server connection\] (\S+) -> (\S+) has connected$/;

function match(msg: string): [string, ...string[]] | null {
  let m: RegExpExecArray | null;
  if ((m = CONNECT.exec(msg))) return ['connect', m[1]];
  if ((m = SERVER.exec(msg))) return ['server', m[1], m[2]];
  return null;
}

/** PROXY_LOG_DIR, else logs/ of the proxy two folders above the server that holds the world */
export async function loadProxyActivity(worldPath: string): Promise<ProxyActivity | null> {
  const serverDir = path.dirname(path.resolve(worldPath));
  const dir = process.env.PROXY_LOG_DIR || path.join(serverDir, '..', '..', 'logs');
  if (!process.env.PROXY_LOG_DIR && !fs.existsSync(path.join(serverDir, '..', '..', 'velocity.toml'))) return null;

  const events = await loadLogEvents(dir, 'proxy-v1', match);
  if (!events) return null;

  const byName = new Map<string, PlayerActivity>();
  for (const [t, kind, name, server] of events) {
    const key = name.toLowerCase();
    let a = byName.get(key);
    if (!a) byName.set(key, (a = { connects: [], servers: [] }));
    if (kind === 'connect') a.connects.push(t);
    else a.servers.push([t, server]);
  }
  return { byName, coverageStart: events[0][0] };
}
