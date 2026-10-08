import type { PlayerRecord, ClusterItem, PlayerItem, ClustersResponse } from '../../shared/protocol.js';
import { lastSeen } from '../../shared/protocol.js';
import { introStatus, type IntroData } from './intro-progress.js';

/** Grid cell size in blocks for spatial indexing */
const SPATIAL_CELL_SIZE = 256;

/** Most records /api/players returns per page */
const MAX_PAGE_SIZE = 10000;

interface SpatialCell {
  cx: number;
  cz: number;
  players: PlayerRecord[];
}

function spatialKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export class PlayerStore {
  private byUuid = new Map<string, PlayerRecord>();
  private byDimension = new Map<string, PlayerRecord[]>();
  /** Lower-cased names for search; a list because names are not unique over time */
  private named: { key: string; player: PlayerRecord }[] = [];
  /** Spatial grid index: dimension → (cellKey → players in that cell) */
  private spatialGrid = new Map<string, Map<string, SpatialCell>>();
  private intro: IntroData | null = null;

  setIntroData(intro: IntroData | null): void {
    this.intro = intro;
  }

  private toPlayerItem(p: PlayerRecord): PlayerItem {
    return {
      type: 'player', uuid: p.uuid, name: p.name, x: p.x, z: p.z, y: p.y,
      firstJoined: p.firstJoined, lastOnline: p.lastOnline,
      introStatus: this.intro ? introStatus(this.intro, p) : undefined,
    };
  }

  /** Swap in a fresh set of records (a refresh), rebuilding every index */
  replaceAll(players: PlayerRecord[]): void {
    this.byUuid = new Map();
    this.byDimension = new Map();
    this.named = [];
    this.spatialGrid = new Map();
    this.addAll(players);
  }

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
        this.named.push({ key: p.name.toLowerCase(), player: p });
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
        cell = { cx, cz, players: [] };
        grid.set(key, cell);
      }
      cell.players.push(p);
    }
  }

  get count(): number {
    return this.byUuid.size;
  }

  /** Every record, unpaginated */
  all(): PlayerRecord[] {
    return Array.from(this.byUuid.values());
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
      players = this.all();
    }

    if (opts?.after) {
      const after = opts.after;
      players = players.filter((p) => lastSeen(p) >= after);
    }
    if (opts?.before) {
      const before = opts.before;
      players = players.filter((p) => lastSeen(p) <= before);
    }

    const total = players.length;
    const offset = opts?.offset || 0;
    const limit = Math.min(opts?.limit || MAX_PAGE_SIZE, MAX_PAGE_SIZE);
    players = players.slice(offset, offset + limit);

    return { players, total };
  }

  /** Exact name matches first, then prefix matches, then substring and UUID-prefix matches */
  search(query: string, limit = 20): PlayerRecord[] {
    const q = query.toLowerCase();
    const exact: PlayerRecord[] = [];
    const prefix: PlayerRecord[] = [];
    const contains: PlayerRecord[] = [];

    for (const { key, player } of this.named) {
      if (key === q) exact.push(player);
      else if (key.startsWith(q)) {
        if (prefix.length < limit) prefix.push(player);
      } else if (contains.length < limit && key.includes(q)) {
        contains.push(player);
      }
    }

    const results = [...exact, ...prefix, ...contains].slice(0, limit);

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

    // Walk the viewport's cells, or the occupied cells when the viewport spans more of them
    const viewportCells = (maxCX - minCX + 1) * (maxCZ - minCZ + 1);
    const cells: SpatialCell[] = [];
    if (viewportCells <= grid.size) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cz = minCZ; cz <= maxCZ; cz++) {
          const cell = grid.get(spatialKey(cx, cz));
          if (cell) cells.push(cell);
        }
      }
    } else {
      for (const cell of grid.values()) {
        if (cell.cx >= minCX && cell.cx <= maxCX && cell.cz >= minCZ && cell.cz <= maxCZ) {
          cells.push(cell);
        }
      }
    }

    // Collect visible players from only the overlapping cells
    const visible: PlayerRecord[] = [];
    for (const cell of cells) {
      for (const p of cell.players) {
        if (p.x < opts.minX || p.x > opts.maxX ||
            p.z < opts.minZ || p.z > opts.maxZ) continue;
        if (opts.after && lastSeen(p) < opts.after) continue;
        if (opts.before && lastSeen(p) > opts.before) continue;
        visible.push(p);
      }
    }

    const totalInView = visible.length;

    // At high zoom, return individual players (capped)
    if (opts.zoom >= 2) {
      return { totalInView, items: visible.slice(0, 2000).map((p) => this.toPlayerItem(p)) };
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
        items.push(this.toPlayerItem(cell.first));
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
}

export const playerStore = new PlayerStore();
