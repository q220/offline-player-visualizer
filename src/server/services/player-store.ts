import type { PlayerRecord, ClusterItem, PlayerItem, ClustersResponse } from '../../shared/protocol.js';

/** Grid cell size in blocks for spatial indexing */
const SPATIAL_CELL_SIZE = 256;

function spatialKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export class PlayerStore {
  private byUuid = new Map<string, PlayerRecord>();
  private byDimension = new Map<string, PlayerRecord[]>();
  private nameIndex = new Map<string, PlayerRecord>();
  /** Spatial grid index: dimension → (cellKey → players in that cell) */
  private spatialGrid = new Map<string, Map<string, PlayerRecord[]>>();

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

      // Insert into spatial grid
      let grid = this.spatialGrid.get(p.dimension);
      if (!grid) {
        grid = new Map();
        this.spatialGrid.set(p.dimension, grid);
      }
      const cx = Math.floor(p.x / SPATIAL_CELL_SIZE);
      const cz = Math.floor(p.z / SPATIAL_CELL_SIZE);
      const key = spatialKey(cx, cz);
      let cell = grid.get(key);
      if (!cell) {
        cell = [];
        grid.set(key, cell);
      }
      cell.push(p);
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

  /**
   * Server-side clustering: uses spatial grid index to efficiently find players
   * within the viewport, then returns individual players or grid-aggregated clusters.
   */
  getClusters(opts: {
    dimension: string;
    zoom: number;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    after?: number;
    before?: number;
  }): ClustersResponse {
    const grid = this.spatialGrid.get(opts.dimension);
    if (!grid) return { totalInView: 0, items: [] };

    // Calculate which spatial cells overlap the viewport
    const minCX = Math.floor(opts.minX / SPATIAL_CELL_SIZE);
    const maxCX = Math.floor(opts.maxX / SPATIAL_CELL_SIZE);
    const minCZ = Math.floor(opts.minZ / SPATIAL_CELL_SIZE);
    const maxCZ = Math.floor(opts.maxZ / SPATIAL_CELL_SIZE);

    // Collect visible players from only the overlapping cells
    const visible: PlayerRecord[] = [];
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const cell = grid.get(spatialKey(cx, cz));
        if (!cell) continue;
        for (const p of cell) {
          if (p.x < opts.minX || p.x > opts.maxX ||
              p.z < opts.minZ || p.z > opts.maxZ) continue;
          if (opts.after && p.lastModified < opts.after) continue;
          if (opts.before && p.lastModified > opts.before) continue;
          visible.push(p);
        }
      }
    }

    const totalInView = visible.length;

    // At high zoom, return individual players (capped)
    if (opts.zoom >= 2) {
      const limit = Math.min(visible.length, 2000);
      const items: PlayerItem[] = [];
      for (let i = 0; i < limit; i++) {
        const p = visible[i];
        items.push({ type: 'player', uuid: p.uuid, name: p.name, x: p.x, z: p.z, y: p.y });
      }
      return { totalInView, items };
    }

    // At low zoom, grid-cluster
    const clusterCellSize = opts.zoom <= -2 ? 128 : opts.zoom <= -1 ? 64 : 32;
    const clusterGrid = new Map<string, {
      sumX: number; sumZ: number; count: number;
      names: string[]; first: PlayerRecord;
    }>();

    for (const p of visible) {
      const cx = Math.floor(p.x / clusterCellSize);
      const cz = Math.floor(p.z / clusterCellSize);
      const key = `${cx},${cz}`;

      let cell = clusterGrid.get(key);
      if (!cell) {
        cell = { sumX: 0, sumZ: 0, count: 0, names: [], first: p };
        clusterGrid.set(key, cell);
      }
      cell.sumX += p.x;
      cell.sumZ += p.z;
      cell.count++;
      if (cell.names.length < 5 && p.name) {
        cell.names.push(p.name);
      }
    }

    const items: (ClusterItem | PlayerItem)[] = [];
    for (const cell of clusterGrid.values()) {
      if (cell.count === 1) {
        const p = cell.first;
        items.push({ type: 'player', uuid: p.uuid, name: p.name, x: p.x, z: p.z, y: p.y });
      } else {
        items.push({
          type: 'cluster',
          x: cell.sumX / cell.count,
          z: cell.sumZ / cell.count,
          count: cell.count,
          names: cell.names,
        });
      }
    }

    return { totalInView, items };
  }

  clear(): void {
    this.byUuid.clear();
    this.byDimension.clear();
    this.nameIndex.clear();
    this.spatialGrid.clear();
  }
}

export const playerStore = new PlayerStore();
