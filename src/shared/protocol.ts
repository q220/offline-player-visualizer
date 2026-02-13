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
}

export interface HeatmapRenderResponse {
  url: string;
}
