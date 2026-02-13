import type { PlayerRecord, WorldInfo } from '../shared/protocol';
import { getMap } from './map';

declare const L: typeof import('leaflet');

let playerDots: L.CircleMarker[] = [];
let allPlayers: PlayerRecord[] = [];
let currentDimension = 'minecraft:overworld';

const MIN_ZOOM_FOR_DOTS = 2;

export function initPlayerLayer(worldInfo: WorldInfo): void {
  const map = getMap();

  map.on('zoomend', () => {
    const zoom = map.getZoom();
    if (zoom >= MIN_ZOOM_FOR_DOTS) {
      showVisiblePlayers();
    } else {
      clearDots();
    }
  });

  map.on('moveend', () => {
    const zoom = map.getZoom();
    if (zoom >= MIN_ZOOM_FOR_DOTS) {
      showVisiblePlayers();
    }
  });
}

export function setPlayers(players: PlayerRecord[]): void {
  allPlayers = players;
}

export function setPlayerDimension(dim: string): void {
  currentDimension = dim;
  clearDots();
}

function showVisiblePlayers(): void {
  clearDots();
  const map = getMap();
  const bounds = map.getBounds();

  const visible = allPlayers.filter(
    (p) =>
      p.dimension === currentDimension &&
      p.z >= bounds.getSouth() &&
      p.z <= bounds.getNorth() &&
      p.x >= bounds.getWest() &&
      p.x <= bounds.getEast(),
  );

  // Limit to prevent performance issues
  const limit = Math.min(visible.length, 5000);
  for (let i = 0; i < limit; i++) {
    const p = visible[i];
    const dot = L.circleMarker(L.latLng(p.z, p.x), {
      radius: 2,
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

    dot.addTo(map);
    playerDots.push(dot);
  }
}

function clearDots(): void {
  const map = getMap();
  for (const dot of playerDots) {
    map.removeLayer(dot);
  }
  playerDots = [];
}
