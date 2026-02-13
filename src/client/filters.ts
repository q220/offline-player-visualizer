import type { WorldInfo, HeatmapRenderResponse } from '../shared/protocol';
import { apiUrl } from './api';
import {
  setBlockMap,
  setHeatmap,
  toggleHeatmapVisibility,
  toggleBlockMapVisibility,
} from './map';
import { setPlayerDimension } from './player-layer';
import { dimensionSlug } from '../shared/constants';

let currentDimension = 'minecraft:overworld';
let worldInfo: WorldInfo;

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
    } catch (e) {
      console.error('Failed to re-render heatmap:', e);
    }
  });

  clearBtn.addEventListener('click', () => {
    afterInput.value = '';
    beforeInput.value = '';
    const slug = dimensionSlug(currentDimension);
    setHeatmap(apiUrl(`/static/heatmap-${slug}.png`), worldInfo);
  });
}

function setDimension(dim: string): void {
  currentDimension = dim;
  setBlockMap(dim, worldInfo);
  setPlayerDimension(dim);
  const slug = dimensionSlug(dim);
  setHeatmap(apiUrl(`/static/heatmap-${slug}.png`), worldInfo);
}

export function getCurrentDimension(): string {
  return currentDimension;
}
