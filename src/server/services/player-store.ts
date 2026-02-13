import type { PlayerRecord } from '../../shared/protocol.js';

export class PlayerStore {
  private byUuid = new Map<string, PlayerRecord>();
  private byDimension = new Map<string, PlayerRecord[]>();
  private nameIndex = new Map<string, PlayerRecord>();

  addAll(players: PlayerRecord[]): void {
    for (const p of players) {
      this.byUuid.set(p.uuid, p);

      const dimList = this.byDimension.get(p.dimension);
      if (dimList) {
        dimList.push(p);
      } else {
        this.byDimension.set(p.dimension, [p]);
      }

      if (p.name) {
        this.nameIndex.set(p.name.toLowerCase(), p);
      }
    }
  }

  get count(): number {
    return this.byUuid.size;
  }

  getByUuid(uuid: string): PlayerRecord | undefined {
    return this.byUuid.get(uuid);
  }

  getAll(opts?: {
    dimension?: string;
    after?: number;
    before?: number;
    limit?: number;
    offset?: number;
  }): { players: PlayerRecord[]; total: number } {
    let players: PlayerRecord[];

    if (opts?.dimension) {
      players = this.byDimension.get(opts.dimension) || [];
    } else {
      players = Array.from(this.byUuid.values());
    }

    if (opts?.after) {
      const after = opts.after;
      players = players.filter((p) => p.lastModified >= after);
    }
    if (opts?.before) {
      const before = opts.before;
      players = players.filter((p) => p.lastModified <= before);
    }

    const total = players.length;
    const offset = opts?.offset || 0;
    const limit = opts?.limit || 10000;
    players = players.slice(offset, offset + limit);

    return { players, total };
  }

  search(query: string, limit = 20): PlayerRecord[] {
    const q = query.toLowerCase();
    const results: PlayerRecord[] = [];

    for (const [name, player] of this.nameIndex) {
      if (name.includes(q)) {
        results.push(player);
        if (results.length >= limit) break;
      }
    }

    // Also search by UUID prefix
    if (results.length < limit) {
      for (const [uuid, player] of this.byUuid) {
        if (uuid.startsWith(q) && !results.includes(player)) {
          results.push(player);
          if (results.length >= limit) break;
        }
      }
    }

    return results;
  }

  getDimensions(): string[] {
    return Array.from(this.byDimension.keys());
  }

  getPlayersByDimension(dimension: string): PlayerRecord[] {
    return this.byDimension.get(dimension) || [];
  }

  clear(): void {
    this.byUuid.clear();
    this.byDimension.clear();
    this.nameIndex.clear();
  }
}

export const playerStore = new PlayerStore();
