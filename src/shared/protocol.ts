export interface PlayerRecord {
  uuid: string;
  name?: string;
  x: number;
  z: number;
  y: number;
  dimension: string;
  lastModified: number;
}

export interface WorldInfo {
  name: string;
  mcVersion: string;
  dimensions: string[];
  playerCount: number;
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  spawn?: { x: number; z: number };
  /** Per-dimension heatmap density info for the legend */
  heatmapDensity?: Record<string, { maxPerChunk: number; totalPlayers: number; contoursUrl: string }>;
  /** Bounds that encompass all player positions (may extend beyond region bounds) */
  playerBounds?: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
}

export interface PlayersResponse {
  players: PlayerRecord[];
  total: number;
}

export interface SearchResponse {
  results: PlayerRecord[];
}

export interface HeatmapRenderRequest {
  dimension: string;
  afterDate?: number;
  beforeDate?: number;
  /** Viewport bounds — when provided, heatmap is normalized to this area only */
  viewport?: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
}

export interface HeatmapRenderResponse {
  url: string;
  contoursUrl: string;
  maxPerChunk: number;
  totalPlayers: number;
}

export interface ContourData {
  levels: {
    value: number;
    lines: number[][][];
  }[];
}

/** Server-side clustering types */

export interface ClusterItem {
  type: 'cluster';
  x: number;
  z: number;
  count: number;
  /** Up to 5 sample player names for the popup */
  names: string[];
}

export interface PlayerItem {
  type: 'player';
  uuid: string;
  name?: string;
  x: number;
  z: number;
  y: number;
}

export interface ClustersResponse {
  /** Total individual players in viewport (before clustering) */
  totalInView: number;
  items: (ClusterItem | PlayerItem)[];
}

/** Default number of days to show players for */
export const DEFAULT_PLAYER_DAYS = 30;
