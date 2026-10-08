import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

/**
 * What the server logs said about each new player, kept after the logs are
 * gone (servers delete them after about three months). Hub visits, the first
 * visit's length, reaching another server and coming back within 7 days are
 * recorded while the logs cover a player, and frozen once they are final:
 * 8 days after the first join. Unlike the caches, this cannot be rebuilt.
 */

export interface HistoryEntry {
  firstJoined: number;
  sessions?: number;
  firstSessionMs?: number;
  reachedServer?: boolean;
  returned7d?: boolean;
  frozen?: boolean;
}

/** The fields the logs give, as recorded */
export type LoggedFields = Pick<HistoryEntry, 'sessions' | 'firstSessionMs' | 'reachedServer' | 'returned7d'>;

const FILE_VERSION = 1;
const FREEZE_AFTER_MS = 8 * 24 * 60 * 60 * 1000;

export const historyFile = path.join(config.dataDir, 'flow-history.json');

export class FlowHistory {
  private changed = false;

  private constructor(private readonly entries: Map<string, HistoryEntry>) {}

  static load(): FlowHistory {
    const entries = new Map<string, HistoryEntry>();
    if (fs.existsSync(historyFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
        if (data?.version !== FILE_VERSION || typeof data.players !== 'object') throw new Error(`unknown format ${data?.version}`);
        for (const [uuid, entry] of Object.entries(data.players)) entries.set(uuid, entry as HistoryEntry);
      } catch (e: any) {
        // Never write over a history we could not read: set it aside and start again
        const aside = `${historyFile}.unreadable-${Date.now()}`;
        fs.renameSync(historyFile, aside);
        console.warn(`  Flow history unreadable (${e.message}); moved to ${aside}`);
      }
    }
    return new FlowHistory(entries);
  }

  get size(): number {
    return this.entries.size;
  }

  get(uuid: string): HistoryEntry | undefined {
    return this.entries.get(uuid);
  }

  /** Earliest first join with this field recorded */
  earliest(field: keyof LoggedFields): number | null {
    let min: number | null = null;
    for (const e of this.entries.values()) {
      if (e[field] !== undefined && (min === null || e.firstJoined < min)) min = e.firstJoined;
    }
    return min;
  }

  /** Record what the logs say about a player now; frozen entries stay as they are */
  record(uuid: string, firstJoined: number, logged: LoggedFields, now: number): void {
    const prev = this.entries.get(uuid);
    if (prev?.frozen) return;
    const next: HistoryEntry = { firstJoined, ...logged };
    if (now - firstJoined >= FREEZE_AFTER_MS && logged.sessions !== undefined && logged.reachedServer !== undefined) {
      next.frozen = true;
    }
    if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) {
      this.entries.set(uuid, next);
      this.changed = true;
    }
  }

  /** Write the file if anything changed since the last save */
  save(): boolean {
    if (!this.changed) return false;
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${historyFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: FILE_VERSION, players: Object.fromEntries(this.entries) }));
    fs.renameSync(tmp, historyFile);
    this.changed = false;
    return true;
  }
}
