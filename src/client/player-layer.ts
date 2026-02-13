import type { WorldInfo, ClustersResponse } from '../shared/protocol';
import { DEFAULT_PLAYER_DAYS } from '../shared/protocol';
import { apiUrl } from './api';
import { getMap } from './map';
import { setStatus, clearStatus } from './status';

declare const L: typeof import('leaflet');

let clusterLayer: L.LayerGroup;
let currentDimension = '';
let afterFilter: number | undefined;
let beforeFilter: number | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let abortController: AbortController | null = null;
let viewportCountControl: L.Control | null = null;
let viewportCountEl: HTMLDivElement | null = null;

/** Set to the default 30-day window initially */
afterFilter = Date.now() - DEFAULT_PLAYER_DAYS * 24 * 60 * 60 * 1000;

export function initPlayerLayer(_worldInfo: WorldInfo): void {
  const map = getMap();
  clusterLayer = L.layerGroup().addTo(map);

  // Create viewport count control
  const CountControl = L.Control.extend({
    onAdd() {
      const div = L.DomUtil.create('div', 'viewport-count');
      div.innerHTML = '<span class="count-number">-</span><span class="count-label"> players in view</span>';
      L.DomEvent.disableClickPropagation(div);
      viewportCountEl = div;
      return div;
    },
  });
  viewportCountControl = new CountControl({ position: 'topright' });
  viewportCountControl.addTo(map);

  map.on('zoomend', scheduleRefresh);
  map.on('moveend', scheduleRefresh);
}

export function setPlayerDimension(dim: string): void {
  currentDimension = dim;
  refresh();
}

/** Called by filters.ts when date filter changes */
export function setPlayerDateFilter(after?: number, before?: number): void {
  afterFilter = after;
  beforeFilter = before;
  refresh();
}

/** Get the current date filter state (used by filters.ts for heatmap sync) */
export function getPlayerDateFilter(): { after?: number; before?: number } {
  return { after: afterFilter, before: beforeFilter };
}

function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 300);
}

async function refresh(): Promise<void> {
  const map = getMap();
  if (!currentDimension) return;

  // Abort any in-flight request
  if (abortController) {
    abortController.abort();
  }
  abortController = new AbortController();

  const bounds = map.getBounds();
  const zoom = map.getZoom();

  const params = new URLSearchParams({
    dimension: currentDimension,
    zoom: zoom.toString(),
    minX: Math.floor(bounds.getWest()).toString(),
    maxX: Math.ceil(bounds.getEast()).toString(),
    minZ: Math.floor(bounds.getSouth()).toString(),
    maxZ: Math.ceil(bounds.getNorth()).toString(),
  });

  if (afterFilter) params.set('after', afterFilter.toString());
  if (beforeFilter) params.set('before', beforeFilter.toString());

  setStatus('players', 'Loading players...');

  try {
    const res = await fetch(
      apiUrl(`/api/players/clusters?${params}`),
      { signal: abortController.signal },
    );
    const data: ClustersResponse = await res.json();

    clusterLayer.clearLayers();
    renderItems(data, zoom);
    updateViewportCount(data.totalInView);
  } catch (e: any) {
    if (e.name === 'AbortError') return; // superseded by newer request
    console.warn('Failed to load player clusters:', e);
  } finally {
    clearStatus('players');
  }
}

function renderItems(data: ClustersResponse, zoom: number): void {
  const radius = Math.max(2, Math.min(6, zoom + 1));

  for (const item of data.items) {
    if (item.type === 'player') {
      const dot = L.circleMarker(L.latLng(item.z, item.x), {
        radius,
        color: '#fff',
        fillColor: '#e94560',
        fillOpacity: 0.8,
        weight: 1,
      });

      dot.bindPopup(
        `<div class="player-popup">
          <div class="popup-name">${item.name || 'Unknown'}</div>
          <div class="popup-info">UUID: ${item.uuid}</div>
          <div class="popup-info">Pos: ${Math.round(item.x)}, ${Math.round(item.y)}, ${Math.round(item.z)}</div>
        </div>`,
      );

      clusterLayer.addLayer(dot);
    } else {
      // Cluster
      const clusterRadius = Math.max(6, Math.min(30, 6 + Math.log2(item.count) * 4));
      const intensity = Math.min(1, Math.log10(item.count) / 3);
      const color = interpolateColor(intensity);

      const circle = L.circleMarker(L.latLng(item.z, item.x), {
        radius: clusterRadius,
        color: '#fff',
        fillColor: color,
        fillOpacity: 0.75,
        weight: 1,
      });

      const countLabel = item.count >= 1000
        ? `${(item.count / 1000).toFixed(1)}k`
        : `${item.count}`;

      const tooltip = L.tooltip({
        permanent: true,
        direction: 'center',
        className: 'cluster-label',
      }).setContent(countLabel);
      circle.bindTooltip(tooltip);

      const names = item.names.join(', ');
      const extra = item.count > item.names.length
        ? ` and ${item.count - item.names.length} more`
        : '';
      circle.bindPopup(
        `<div class="player-popup">
          <div class="popup-name">${item.count} players</div>
          <div class="popup-info">${names}${extra}</div>
        </div>`,
      );

      clusterLayer.addLayer(circle);
    }
  }
}

function updateViewportCount(count: number): void {
  if (!viewportCountEl) return;
  const formatted = count >= 1000
    ? `${(count / 1000).toFixed(1)}k`
    : count.toLocaleString();
  viewportCountEl.innerHTML =
    `<span class="count-number">${formatted}</span><span class="count-label"> players in view</span>`;
}

function interpolateColor(t: number): string {
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
