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
