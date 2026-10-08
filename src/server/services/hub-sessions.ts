import path from 'path';
import { loadLogEvents, type LogEvent } from './log-events.js';

/**
 * Hub sessions (join → leave) per player, from the hub server's logs.
 * Coverage starts at the oldest log the server still keeps.
 */

export interface Session {
  start: number;
  /** null while online, or when the server died without logging the leave */
  end: number | null;
}

export interface SessionData {
  byUuid: Map<string, Session[]>;
  /** Time of the first logged event; sessions before it are unknown */
  coverageStart: number;
}

const UUID_OF = /^UUID of player (\S+) is ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const LOGIN = /^([^\s[]+)\[\/[^\]]*\] logged in with entity id /;
const QUIT = /^(\S+) lost connection: /;

function match(msg: string): [string, ...string[]] | null {
  let m: RegExpExecArray | null;
  if ((m = UUID_OF.exec(msg))) return ['uuid', m[1], m[2]];
  if ((m = LOGIN.exec(msg))) return ['in', m[1]];
  if ((m = QUIT.exec(msg))) return ['out', m[1]];
  if (msg === 'Stopping server') return ['stop'];
  return null;
}

/** HUB_LOG_DIR, else logs/ in the server folder that holds the world */
export async function loadHubSessions(worldPath: string): Promise<SessionData | null> {
  const dir = process.env.HUB_LOG_DIR || path.join(path.dirname(path.resolve(worldPath)), 'logs');
  const events = await loadLogEvents(dir, 'hub-v1', match);
  return events ? { byUuid: assembleSessions(events), coverageStart: events[0][0] } : null;
}

function assembleSessions(events: LogEvent[]): Map<string, Session[]> {
  const byUuid = new Map<string, Session[]>();
  const uuidOf = new Map<string, string>();
  const open = new Map<string, number>();

  const close = (uuid: string, end: number | null) => {
    const start = open.get(uuid);
    if (start === undefined) return;
    open.delete(uuid);
    let list = byUuid.get(uuid);
    if (!list) byUuid.set(uuid, (list = []));
    list.push({ start, end });
  };

  for (const [t, kind, name, uuid] of events) {
    if (kind === 'uuid') {
      uuidOf.set(name, uuid);
    } else if (kind === 'stop') {
      for (const id of [...open.keys()]) close(id, t);
    } else {
      const id = uuidOf.get(name);
      if (!id) continue;
      if (kind === 'in') {
        close(id, null); // a join without a logged leave: the earlier session's end is unknown
        open.set(id, t);
      } else {
        close(id, t);
      }
    }
  }
  for (const id of [...open.keys()]) close(id, null);
  return byUuid;
}
