import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

/**
 * When each resource pack release first showed up in Architect's table.
 * The table keeps only each player's latest pack, without a time, so the
 * tool notes a release the first refresh it appears (within 15 minutes).
 * Releases already there when tracking started have no time (null). Like the
 * flow history, this cannot be rebuilt.
 */

interface ReleaseEntry {
  pack: string;
  version: string;
  variant: string;
  firstSeen: number | null;
}

const FILE_VERSION = 1;

export const releaseLogFile = path.join(config.dataDir, 'pack-releases.json');

export const releaseKey = (r: { pack: string; version: string; variant: string }) => `${r.pack}\0${r.version}\0${r.variant}`;

export class ReleaseLog {
  private changed = false;

  private constructor(
    private trackingSince: number | null,
    private readonly entries: Map<string, ReleaseEntry>,
  ) {}

  static load(): ReleaseLog {
    const entries = new Map<string, ReleaseEntry>();
    let since: number | null = null;
    if (fs.existsSync(releaseLogFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(releaseLogFile, 'utf-8'));
        if (data?.version !== FILE_VERSION || !Array.isArray(data.releases)) throw new Error(`unknown format ${data?.version}`);
        since = typeof data.trackingSince === 'number' ? data.trackingSince : null;
        for (const r of data.releases as ReleaseEntry[]) entries.set(releaseKey(r), r);
      } catch (e: any) {
        // Never write over a log we could not read: set it aside and start again
        const aside = `${releaseLogFile}.unreadable-${Date.now()}`;
        fs.renameSync(releaseLogFile, aside);
        console.warn(`  Pack release log unreadable (${e.message}); moved to ${aside}`);
      }
    }
    return new ReleaseLog(since, entries);
  }

  get since(): number | null {
    return this.trackingSince;
  }

  /** Null for a release that was there when tracking started, undefined for one never seen */
  firstSeen(r: { pack: string; version: string; variant: string }): number | null | undefined {
    return this.entries.get(releaseKey(r))?.firstSeen;
  }

  /** Note the releases in the table now; the first call only takes stock */
  observe(releases: Iterable<{ pack: string; version: string; variant: string }>, now: number): void {
    const first = this.trackingSince === null;
    if (first) {
      this.trackingSince = now;
      this.changed = true;
    }
    for (const r of releases) {
      const key = releaseKey(r);
      if (this.entries.has(key)) continue;
      this.entries.set(key, { pack: r.pack, version: r.version, variant: r.variant, firstSeen: first ? null : now });
      this.changed = true;
    }
  }

  /** Write the file if anything changed since the last save */
  save(): boolean {
    if (!this.changed) return false;
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${releaseLogFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: FILE_VERSION, trackingSince: this.trackingSince, releases: [...this.entries.values()] }));
    fs.renameSync(tmp, releaseLogFile);
    this.changed = false;
    return true;
  }
}
