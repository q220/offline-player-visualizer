import type { WorldInfo, PlayersResponse } from '../shared/protocol';
import { dimensionSlug } from '../shared/constants';
import { apiUrl } from './api';
import { initMap, setBlockMap, setHeatmap, getMap } from './map';
import { initSearch } from './search';
import { initFilters } from './filters';
import { initSidebar } from './sidebar';
import { initPlayerLayer, setPlayers, setPlayerDimension } from './player-layer';

declare const L: typeof import('leaflet');

async function init(): Promise<void> {
  const loadingOverlay = document.getElementById('loading-overlay')!;

  try {
    // 1. Fetch world info
    const infoRes = await fetch(apiUrl('/api/world-info'));
    const worldInfo: WorldInfo = await infoRes.json();

    // 2. Initialize map
    const map = initMap(worldInfo);

    // 3. Initialize sidebar
    initSidebar(worldInfo);

    // 4. Prefer overworld as default, fall back to first available
    const defaultDim = worldInfo.dimensions.includes('minecraft:overworld')
      ? 'minecraft:overworld'
      : worldInfo.dimensions[0] || 'minecraft:overworld';
    setBlockMap(defaultDim, worldInfo);
    const slug = dimensionSlug(defaultDim);
    setHeatmap(apiUrl(`/static/heatmap-${slug}.png`), worldInfo);

    // 5. Initialize filters (dimension toggles, date, layers)
    initFilters(worldInfo);

    // 6. Initialize search
    initSearch();

    // 7. Initialize player dot layer with matching dimension
    initPlayerLayer(worldInfo);
    setPlayerDimension(defaultDim);

    // 8. Load players for dot display + auto-zoom to player area
    try {
      const playersRes = await fetch(apiUrl('/api/players?limit=500000'));
      const data: PlayersResponse = await playersRes.json();
      setPlayers(data.players);

      // Auto-zoom to the bounding box of players in the current dimension
      const dimPlayers = data.players.filter((p) => p.dimension === defaultDim);
      if (dimPlayers.length > 0) {
        let pMinX = Infinity, pMaxX = -Infinity, pMinZ = Infinity, pMaxZ = -Infinity;
        for (const p of dimPlayers) {
          if (p.x < pMinX) pMinX = p.x;
          if (p.x > pMaxX) pMaxX = p.x;
          if (p.z < pMinZ) pMinZ = p.z;
          if (p.z > pMaxZ) pMaxZ = p.z;
        }
        // Pad slightly so dots aren't on the edge
        const pad = Math.max(20, (pMaxX - pMinX) * 0.05, (pMaxZ - pMinZ) * 0.05);
        map.fitBounds([
          [pMinZ - pad, pMinX - pad],
          [pMaxZ + pad, pMaxX + pad],
        ]);
      }
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
