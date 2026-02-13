import type { WorldInfo, HeatmapRenderResponse } from '../shared/protocol';
import { apiUrl } from './api';
import {
  setBlockMap,
  setHeatmap,
  setHeatmapLegend,
  loadContours,
  toggleHeatmapVisibility,
  toggleBlockMapVisibility,
  getMap,
} from './map';
import { setPlayerDimension } from './player-layer';
import { dimensionSlug } from '../shared/constants';

let currentDimension = 'minecraft:overworld';
let worldInfo: WorldInfo;
let viewportTimer: ReturnType<typeof setTimeout> | null = null;
let viewportRenderInFlight = false;

export function initFilters(info: WorldInfo): void {
  worldInfo = info;

  // Set current dimension: prefer overworld, fall back to first
  currentDimension = info.dimensions.includes('minecraft:overworld')
    ? 'minecraft:overworld'
    : info.dimensions[0] || 'minecraft:overworld';

  // Dimension toggles
  const container = document.getElementById('dimension-toggles')!;
  container.innerHTML = '';

  for (const dim of info.dimensions) {
    const btn = document.createElement('button');
    btn.className = `toggle-btn${dim === currentDimension ? ' active' : ''}`;
    btn.textContent = dimensionSlug(dim);
    btn.dataset.dimension = dim;

    btn.addEventListener('click', () => {
      setDimension(dim);
      container
        .querySelectorAll('.toggle-btn')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });

    container.appendChild(btn);
  }

  // Layer toggles
  const toggleHeatmapEl = document.getElementById(
    'toggle-heatmap',
  ) as HTMLInputElement;
  const toggleBlockmapEl = document.getElementById(
    'toggle-blockmap',
  ) as HTMLInputElement;

  toggleHeatmapEl.addEventListener('change', () => {
    toggleHeatmapVisibility(toggleHeatmapEl.checked);
  });
  toggleBlockmapEl.addEventListener('change', () => {
    toggleBlockMapVisibility(toggleBlockmapEl.checked);
  });

  // Date filter
  const applyBtn = document.getElementById('apply-date-filter')!;
  const clearBtn = document.getElementById('clear-date-filter')!;
  const afterInput = document.getElementById('date-after') as HTMLInputElement;
  const beforeInput = document.getElementById('date-before') as HTMLInputElement;

  applyBtn.addEventListener('click', async () => {
    const afterDate = afterInput.value
      ? new Date(afterInput.value).getTime()
      : undefined;
    const beforeDate = beforeInput.value
      ? new Date(beforeInput.value).getTime()
      : undefined;

    try {
      const res = await fetch(apiUrl('/api/heatmap/render'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dimension: currentDimension,
          afterDate,
          beforeDate,
        }),
      });
      const data: HeatmapRenderResponse = await res.json();
      setHeatmap(apiUrl(data.url), worldInfo);
      setHeatmapLegend(data.maxPerChunk, data.totalPlayers);
      if (data.contoursUrl) {
        loadContours(data.contoursUrl);
      }
    } catch (e) {
      console.error('Failed to re-render heatmap:', e);
    }
  });

  clearBtn.addEventListener('click', () => {
    afterInput.value = '';
    beforeInput.value = '';
    const slug = dimensionSlug(currentDimension);
    setHeatmap(apiUrl(`/static/heatmap-${slug}.png`), worldInfo);
    if (worldInfo.heatmapDensity?.[currentDimension]) {
      const density = worldInfo.heatmapDensity[currentDimension];
      setHeatmapLegend(density.maxPerChunk, density.totalPlayers);
      if (density.contoursUrl) {
        loadContours(density.contoursUrl);
      }
    }
  });

  // Viewport-dependent heatmap re-rendering
  const map = getMap();
  map.on('moveend', () => scheduleViewportRender());
  map.on('zoomend', () => scheduleViewportRender());
}

function setDimension(dim: string): void {
  currentDimension = dim;
  setBlockMap(dim, worldInfo);
  setPlayerDimension(dim);
  const slug = dimensionSlug(dim);
  setHeatmap(apiUrl(`/static/heatmap-${slug}.png`), worldInfo);
  if (worldInfo.heatmapDensity?.[dim]) {
    const density = worldInfo.heatmapDensity[dim];
    setHeatmapLegend(density.maxPerChunk, density.totalPlayers);
    if (density.contoursUrl) {
      loadContours(density.contoursUrl);
    }
  }
}

function scheduleViewportRender(): void {
  if (viewportTimer) clearTimeout(viewportTimer);
  viewportTimer = setTimeout(() => renderForViewport(), 800);
}

async function renderForViewport(): Promise<void> {
  if (viewportRenderInFlight) return;

  const map = getMap();
  const zoom = map.getZoom();

  // Only do viewport-dependent rendering when zoomed in enough
  // At overview zoom, the global heatmap is fine
  if (zoom < -1) return;

  const bounds = map.getBounds();
  const viewport = {
    minX: Math.floor(bounds.getWest()),
    maxX: Math.ceil(bounds.getEast()),
    minZ: Math.floor(bounds.getSouth()),
    maxZ: Math.ceil(bounds.getNorth()),
  };

  // Don't re-render if viewport covers most of the world
  const worldW = worldInfo.bounds.maxX - worldInfo.bounds.minX;
  const worldH = worldInfo.bounds.maxZ - worldInfo.bounds.minZ;
  const vpW = viewport.maxX - viewport.minX;
  const vpH = viewport.maxZ - viewport.minZ;
  if (vpW >= worldW * 0.8 && vpH >= worldH * 0.8) return;

  viewportRenderInFlight = true;
  try {
    const res = await fetch(apiUrl('/api/heatmap/render'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dimension: currentDimension,
        viewport,
      }),
    });
    const data: HeatmapRenderResponse = await res.json();
    setHeatmap(apiUrl(data.url), worldInfo);
    setHeatmapLegend(data.maxPerChunk, data.totalPlayers);
    if (data.contoursUrl) {
      loadContours(data.contoursUrl);
    }
  } catch (e) {
    console.warn('Viewport heatmap render failed:', e);
  } finally {
    viewportRenderInFlight = false;
  }
}

export function getCurrentDimension(): string {
  return currentDimension;
}
