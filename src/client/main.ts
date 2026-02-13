import type { WorldInfo, PlayersResponse } from '../shared/protocol';
import { dimensionSlug } from '../shared/constants';
import { initMap, setBlockMap, setHeatmap, getMap } from './map';
import { initSearch } from './search';
import { initFilters } from './filters';
import { initSidebar } from './sidebar';
import { initPlayerLayer, setPlayers } from './player-layer';

declare const L: typeof import('leaflet');

async function init(): Promise<void> {
  const loadingOverlay = document.getElementById('loading-overlay')!;

  try {
    // 1. Fetch world info
    const infoRes = await fetch('/api/world-info');
    const worldInfo: WorldInfo = await infoRes.json();

    // 2. Initialize map
    const map = initMap(worldInfo);

    // 3. Initialize sidebar
    initSidebar(worldInfo);

    // 4. Set up block map and heatmap for default dimension
    const defaultDim =
      worldInfo.dimensions[0] || 'minecraft:overworld';
    setBlockMap(defaultDim, worldInfo);
    const slug = dimensionSlug(defaultDim);
    setHeatmap(`/static/heatmap-${slug}.png`, worldInfo);

    // 5. Initialize filters (dimension toggles, date, layers)
    initFilters(worldInfo);

    // 6. Initialize search
    initSearch();

    // 7. Initialize player dot layer
    initPlayerLayer(worldInfo);

    // 8. Load players for dot display
    try {
      const playersRes = await fetch('/api/players?limit=100000');
      const data: PlayersResponse = await playersRes.json();
      setPlayers(data.players);
    } catch (e) {
      console.warn('Failed to load player data for dots:', e);
    }

    // 9. Set up coordinate display on hover
    const coordDisplay = document.getElementById('coord-display')!;
    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      const x = Math.round(e.latlng.lng);
      const z = Math.round(e.latlng.lat);
      coordDisplay.innerHTML = `<span>X: ${x} &nbsp; Z: ${z}</span>`;
    });

    // Hide loading
    loadingOverlay.classList.add('hidden');
  } catch (err) {
    console.error('Failed to initialize:', err);
    loadingOverlay.innerHTML = `
      <div class="loading-content">
        <p style="color: var(--accent)">Failed to load world data</p>
        <p style="font-size: 13px; color: var(--text-secondary); margin-top: 8px">
          Make sure the server is running and the world path is correct.
        </p>
      </div>
    `;
  }
}

init();
