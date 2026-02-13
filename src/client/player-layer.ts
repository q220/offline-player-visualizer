import type { PlayerRecord, WorldInfo } from '../shared/protocol';
import { getMap } from './map';

declare const L: typeof import('leaflet');

let clusterLayer: L.LayerGroup;
let allPlayers: PlayerRecord[] = [];
let currentDimension = '';

export function initPlayerLayer(worldInfo: WorldInfo): void {
  const map = getMap();
  clusterLayer = L.layerGroup().addTo(map);

  map.on('zoomend', refresh);
  map.on('moveend', refresh);
}

export function setPlayers(players: PlayerRecord[]): void {
  allPlayers = players;
  refresh();
}

export function setPlayerDimension(dim: string): void {
  currentDimension = dim;
  refresh();
}

function refresh(): void {
  clusterLayer.clearLayers();
  const map = getMap();
  const zoom = map.getZoom();
  const bounds = map.getBounds();

  // Filter to visible players in current dimension
  const visible = allPlayers.filter(
    (p) =>
      p.dimension === currentDimension &&
      p.z >= bounds.getSouth() &&
      p.z <= bounds.getNorth() &&
      p.x >= bounds.getWest() &&
      p.x <= bounds.getEast(),
  );

  if (visible.length === 0) return;

  // At high zoom, show individual dots
  // At low zoom, show grid-clustered circles
  if (zoom >= 2) {
    showDots(visible, zoom);
  } else {
    showClusters(visible, zoom);
  }
}

function showDots(players: PlayerRecord[], zoom: number): void {
  const map = getMap();
  const radius = Math.max(2, Math.min(6, zoom + 1));
  const limit = Math.min(players.length, 8000);

  for (let i = 0; i < limit; i++) {
    const p = players[i];
    const dot = L.circleMarker(L.latLng(p.z, p.x), {
      radius,
      color: '#fff',
      fillColor: '#e94560',
      fillOpacity: 0.8,
      weight: 1,
    });

    dot.bindPopup(
      `<div class="player-popup">
        <div class="popup-name">${p.name || 'Unknown'}</div>
        <div class="popup-info">UUID: ${p.uuid}</div>
        <div class="popup-info">Pos: ${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}</div>
      </div>`,
    );

    clusterLayer.addLayer(dot);
  }
}

function showClusters(players: PlayerRecord[], zoom: number): void {
  // Grid-based clustering: cell size depends on zoom level
  const cellSize = zoom <= -2 ? 128 : zoom <= -1 ? 64 : 32;
  const clusters = new Map<string, { x: number; z: number; count: number; players: PlayerRecord[] }>();

  for (const p of players) {
    const cx = Math.floor(p.x / cellSize);
    const cz = Math.floor(p.z / cellSize);
    const key = `${cx},${cz}`;

    let cluster = clusters.get(key);
    if (!cluster) {
      cluster = { x: 0, z: 0, count: 0, players: [] };
      clusters.set(key, cluster);
    }
    cluster.x += p.x;
    cluster.z += p.z;
    cluster.count++;
    if (cluster.players.length < 5) cluster.players.push(p);
  }

  for (const cluster of clusters.values()) {
    const avgX = cluster.x / cluster.count;
    const avgZ = cluster.z / cluster.count;

    // Size based on count (log scale)
    const radius = Math.max(6, Math.min(30, 6 + Math.log2(cluster.count) * 4));

    // Color intensity based on count
    const intensity = Math.min(1, Math.log10(cluster.count) / 3);
    const color = interpolateColor(intensity);

    const circle = L.circleMarker(L.latLng(avgZ, avgX), {
      radius,
      color: '#fff',
      fillColor: color,
      fillOpacity: 0.75,
      weight: 1,
    });

    // Show count label
    const tooltip = L.tooltip({
      permanent: true,
      direction: 'center',
      className: 'cluster-label',
    }).setContent(cluster.count >= 1000 ? `${(cluster.count / 1000).toFixed(1)}k` : `${cluster.count}`);

    circle.bindTooltip(tooltip);

    const names = cluster.players.map((p) => p.name || p.uuid.slice(0, 8)).join(', ');
    const extra = cluster.count > 5 ? ` and ${cluster.count - 5} more` : '';
    circle.bindPopup(
      `<div class="player-popup">
        <div class="popup-name">${cluster.count} players</div>
        <div class="popup-info">${names}${extra}</div>
      </div>`,
    );

    clusterLayer.addLayer(circle);
  }
}

function interpolateColor(t: number): string {
  // Blue -> Yellow -> Red
  let r: number, g: number, b: number;
  if (t < 0.5) {
    const s = t / 0.5;
    r = Math.round(59 + s * 190);
    g = Math.round(130 + s * 70);
    b = Math.round(246 * (1 - s));
  } else {
    const s = (t - 0.5) / 0.5;
    r = Math.round(249);
    g = Math.round(200 * (1 - s));
    b = Math.round(0);
  }
  return `rgb(${r},${g},${b})`;
}
