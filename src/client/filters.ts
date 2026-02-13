import type { WorldInfo, HeatmapRenderResponse } from '../shared/protocol';
import { DEFAULT_PLAYER_DAYS } from '../shared/protocol';
import { apiUrl } from './api';
import {
  setBlockMap,
  setHeatmap,
  setHeatmapLegend,
  loadContours,
  toggleHeatmapVisibility,
  toggleBlockMapVisibility,
  toggleExtendedBounds,
  setCustomBounds,
  getMap,
} from './map';
import { setPlayerDimension, setPlayerDateFilter, getPlayerDateFilter, setPlayerExtendedBounds, setAreaBoundsOverride } from './player-layer';
import { initAreaSelect, onAreaBoundsChange, onDrawModeChange, enterDrawMode, clearArea, getAreaBounds } from './area-select';
import { dimensionSlug } from '../shared/constants';
import { setStatus, clearStatus } from './status';

let currentDimension = 'minecraft:overworld';
let worldInfo: WorldInfo;
let viewportTimer: ReturnType<typeof setTimeout> | null = null;
let viewportAbortController: AbortController | null = null;
let filterInfoEl: HTMLDivElement;

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

  // Out-of-bounds players toggle
  const toggleOobEl = document.getElementById(
    'toggle-oob-players',
  ) as HTMLInputElement | null;
  if (toggleOobEl) {
    if (!info.playerBounds) {
      toggleOobEl.disabled = true;
      toggleOobEl.parentElement!.title = 'No players found outside world bounds';
      toggleOobEl.parentElement!.style.opacity = '0.5';
    }
    toggleOobEl.addEventListener('change', () => {
      toggleExtendedBounds(toggleOobEl.checked);
      setPlayerExtendedBounds(toggleOobEl.checked);
    });
  }

  // Date filter elements
  const applyBtn = document.getElementById('apply-date-filter')! as HTMLButtonElement;
  const clearBtn = document.getElementById('clear-date-filter')! as HTMLButtonElement;
  const showAllBtn = document.getElementById('show-all-players')! as HTMLButtonElement;
  const afterInput = document.getElementById('date-after') as HTMLInputElement;
  const beforeInput = document.getElementById('date-before') as HTMLInputElement;
  filterInfoEl = document.getElementById('filter-info') as HTMLDivElement;

  // Show initial filter state
  updateFilterInfo('default');

  // Apply date filter → both heatmap and player dots
  applyBtn.addEventListener('click', async () => {
    const afterDate = afterInput.value
      ? new Date(afterInput.value).getTime()
      : undefined;
    const beforeDate = beforeInput.value
      ? new Date(beforeInput.value).getTime()
      : undefined;

    applyBtn.classList.add('loading');
    applyBtn.disabled = true;
    setStatus('heatmap-render', 'Rendering heatmap with date filter...');

    // Update player dots with same filter
    setPlayerDateFilter(afterDate, beforeDate);

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

      // Update label
      updateFilterInfo('custom', afterInput.value, beforeInput.value);
    } catch (e) {
      console.error('Failed to re-render heatmap:', e);
    } finally {
      applyBtn.classList.remove('loading');
      applyBtn.disabled = false;
      clearStatus('heatmap-render');
    }
  });

  // Clear → reset to 30-day default
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
    // Reset player dots to 30-day default
    const defaultAfter = Date.now() - DEFAULT_PLAYER_DAYS * 24 * 60 * 60 * 1000;
    setPlayerDateFilter(defaultAfter, undefined);
    updateFilterInfo('default');
  });

  // Show All → no date filter at all
  showAllBtn.addEventListener('click', async () => {
    afterInput.value = '';
    beforeInput.value = '';

    showAllBtn.classList.add('loading');
    showAllBtn.disabled = true;
    setStatus('heatmap-render', 'Rendering heatmap for all players...');

    // Remove date filter from player dots
    setPlayerDateFilter(undefined, undefined);

    try {
      const res = await fetch(apiUrl('/api/heatmap/render'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dimension: currentDimension,
        }),
      });
      const data: HeatmapRenderResponse = await res.json();
      setHeatmap(apiUrl(data.url), worldInfo);
      setHeatmapLegend(data.maxPerChunk, data.totalPlayers);
      if (data.contoursUrl) {
        loadContours(data.contoursUrl);
      }

      updateFilterInfo('all');
    } catch (e) {
      console.error('Failed to re-render heatmap:', e);
    } finally {
      showAllBtn.classList.remove('loading');
      showAllBtn.disabled = false;
      clearStatus('heatmap-render');
    }
  });

  // Viewport-dependent heatmap re-rendering
  const map = getMap();
  map.on('moveend', () => scheduleViewportRender());
  map.on('zoomend', () => scheduleViewportRender());

  // Area select tool
  initAreaSelect(map, info);

  const areaDrawBtn = document.getElementById('area-draw-btn') as HTMLButtonElement;
  const areaClearBtn = document.getElementById('area-clear-btn') as HTMLButtonElement;
  const areaInfoEl = document.getElementById('area-info') as HTMLDivElement;

  areaDrawBtn.addEventListener('click', () => {
    enterDrawMode();
  });

  areaClearBtn.addEventListener('click', () => {
    clearArea();
  });

  onDrawModeChange((active) => {
    areaDrawBtn.textContent = active ? 'Click & drag on map...' : 'Draw Rectangle';
    areaDrawBtn.classList.toggle('drawing', active);
  });

  onAreaBoundsChange((bounds, opts) => {
    // Update map maxBounds; only fitBounds on initial draw, not corner adjustments
    const fit = opts?.fit !== false;
    setCustomBounds(bounds, fit);
    // Clamp player dots to area
    setAreaBoundsOverride(bounds);
    // Disable OOB toggle while area is active
    if (toggleOobEl) {
      if (bounds) {
        toggleOobEl.disabled = true;
        toggleOobEl.parentElement!.style.opacity = '0.5';
      } else if (info.playerBounds) {
        toggleOobEl.disabled = false;
        toggleOobEl.parentElement!.style.opacity = '1';
      }
    }
    // Update sidebar UI
    if (bounds) {
      areaClearBtn.style.display = '';
      const w = bounds.maxX - bounds.minX;
      const h = bounds.maxZ - bounds.minZ;
      areaInfoEl.textContent = `${w} x ${h} blocks (${bounds.minX}, ${bounds.minZ}) to (${bounds.maxX}, ${bounds.maxZ})`;
      renderAreaHeatmap(bounds);
    } else {
      areaClearBtn.style.display = 'none';
      areaInfoEl.textContent = '';
      // Restore default heatmap
      const slug = dimensionSlug(currentDimension);
      setHeatmap(apiUrl(`/static/heatmap-${slug}.png`), worldInfo);
      if (worldInfo.heatmapDensity?.[currentDimension]) {
        const density = worldInfo.heatmapDensity[currentDimension];
        setHeatmapLegend(density.maxPerChunk, density.totalPlayers);
        if (density.contoursUrl) {
          loadContours(density.contoursUrl);
        }
      }
    }
  });
}

function updateFilterInfo(
  mode: 'default' | 'custom' | 'all',
  afterStr?: string,
  beforeStr?: string,
): void {
  if (!filterInfoEl) return;

  if (mode === 'all') {
    filterInfoEl.textContent = 'Showing all players (all time)';
  } else if (mode === 'custom') {
    const parts: string[] = [];
    if (afterStr) parts.push(`from ${afterStr}`);
    if (beforeStr) parts.push(`to ${beforeStr}`);
    filterInfoEl.textContent = parts.length > 0
      ? `Showing players ${parts.join(' ')}`
      : `Showing players from the last ${DEFAULT_PLAYER_DAYS} days`;
  } else {
    filterInfoEl.textContent = `Showing players from the last ${DEFAULT_PLAYER_DAYS} days`;
  }
}

function setDimension(dim: string): void {
  currentDimension = dim;
  clearArea(); // Clear area selection on dimension switch
  setBlockMap(dim, worldInfo);
  setPlayerDimension(dim);

  // Load pre-rendered heatmap (rendered with default 30-day filter)
  setStatus('heatmap-dimension', 'Loading heatmap...');
  const slug = dimensionSlug(dim);
  setHeatmap(apiUrl(`/static/heatmap-${slug}.png`), worldInfo);
  if (worldInfo.heatmapDensity?.[dim]) {
    const density = worldInfo.heatmapDensity[dim];
    setHeatmapLegend(density.maxPerChunk, density.totalPlayers);
    if (density.contoursUrl) {
      loadContours(density.contoursUrl);
    }
  }
  clearStatus('heatmap-dimension');
}

function scheduleViewportRender(): void {
  if (viewportTimer) clearTimeout(viewportTimer);
  viewportTimer = setTimeout(() => renderForViewport(), 500);
}

async function renderAreaHeatmap(area: { minX: number; maxX: number; minZ: number; maxZ: number }): Promise<void> {
  if (viewportAbortController) viewportAbortController.abort();
  viewportAbortController = new AbortController();

  const dateFilter = getPlayerDateFilter();
  setStatus('heatmap-area', 'Rendering heatmap for selected area...');
  try {
    const res = await fetch(apiUrl('/api/heatmap/render'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dimension: currentDimension,
        renderBounds: area,
        viewport: area,
        afterDate: dateFilter.after,
        beforeDate: dateFilter.before,
      }),
      signal: viewportAbortController.signal,
    });
    const data: HeatmapRenderResponse = await res.json();
    // Place overlay at the area bounds (not world bounds) since the PNG covers only the area
    setHeatmap(apiUrl(data.url), worldInfo, area);
    setHeatmapLegend(data.maxPerChunk, data.totalPlayers);
    if (data.contoursUrl) {
      loadContours(data.contoursUrl);
    }
  } catch (e: any) {
    if (e.name !== 'AbortError') {
      console.warn('Area heatmap render failed:', e);
    }
  } finally {
    viewportAbortController = null;
    clearStatus('heatmap-area');
  }
}

async function renderForViewport(): Promise<void> {
  // Skip viewport re-rendering when a custom area is active
  if (getAreaBounds()) return;

  const map = getMap();
  const bounds = map.getBounds();
  // Clamp viewport to world bounds so we don't render heatmap for OOB areas
  const wb = worldInfo.bounds;
  const viewport = {
    minX: Math.floor(Math.max(bounds.getWest(), wb.minX)),
    maxX: Math.ceil(Math.min(bounds.getEast(), wb.maxX)),
    minZ: Math.floor(Math.max(bounds.getSouth(), wb.minZ)),
    maxZ: Math.ceil(Math.min(bounds.getNorth(), wb.maxZ)),
  };

  // Skip if viewport covers nearly the entire world (result ≈ startup heatmap)
  const worldW = worldInfo.bounds.maxX - worldInfo.bounds.minX;
  const worldH = worldInfo.bounds.maxZ - worldInfo.bounds.minZ;
  const vpW = viewport.maxX - viewport.minX;
  const vpH = viewport.maxZ - viewport.minZ;
  if (vpW >= worldW * 0.95 && vpH >= worldH * 0.95) return;

  // Cancel any in-flight viewport render
  if (viewportAbortController) {
    viewportAbortController.abort();
  }
  viewportAbortController = new AbortController();

  // Include active date filter so the heatmap matches the player dots
  const dateFilter = getPlayerDateFilter();

  setStatus('heatmap-viewport', 'Refining heatmap for viewport...');
  try {
    const res = await fetch(apiUrl('/api/heatmap/render'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dimension: currentDimension,
        viewport,
        afterDate: dateFilter.after,
        beforeDate: dateFilter.before,
      }),
      signal: viewportAbortController.signal,
    });
    const data: HeatmapRenderResponse = await res.json();
    setHeatmap(apiUrl(data.url), worldInfo);
    setHeatmapLegend(data.maxPerChunk, data.totalPlayers);
    if (data.contoursUrl) {
      loadContours(data.contoursUrl);
    }
  } catch (e: any) {
    if (e.name !== 'AbortError') {
      console.warn('Viewport heatmap render failed:', e);
    }
  } finally {
    viewportAbortController = null;
    clearStatus('heatmap-viewport');
  }
}

export function getCurrentDimension(): string {
  return currentDimension;
}
