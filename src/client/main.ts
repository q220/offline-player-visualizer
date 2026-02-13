import type { WorldInfo } from '../shared/protocol';
import { dimensionSlug } from '../shared/constants';
import { apiUrl } from './api';
import { initMap, setBlockMap, setHeatmap, setHeatmapLegend, loadContours } from './map';
import { initSearch } from './search';
import { initFilters } from './filters';
import { initSidebar } from './sidebar';
import { initPlayerLayer, setPlayerDimension } from './player-layer';
import { initStatus } from './status';

declare const L: typeof import('leaflet');

async function init(): Promise<void> {
  const loadingOverlay = document.getElementById('loading-overlay')!;

  try {
    // 1. Fetch world info
    const infoRes = await fetch(apiUrl('/api/world-info'));
    const worldInfo: WorldInfo = await infoRes.json();

    // 2. Initialize map
    const map = initMap(worldInfo);

    // 3. Initialize status bar (must be before modules that produce status)
    initStatus();

    // 4. Initialize sidebar
    initSidebar(worldInfo);

    // 5. Prefer overworld as default, fall back to first available
    const defaultDim = worldInfo.dimensions.includes('minecraft:overworld')
      ? 'minecraft:overworld'
      : worldInfo.dimensions[0] || 'minecraft:overworld';
    setBlockMap(defaultDim, worldInfo);
    const slug = dimensionSlug(defaultDim);
    setHeatmap(apiUrl(`/static/heatmap-${slug}.png`), worldInfo);

    // 5b. Show heatmap legend and contour lines
    if (worldInfo.heatmapDensity?.[defaultDim]) {
      const density = worldInfo.heatmapDensity[defaultDim];
      setHeatmapLegend(density.maxPerChunk, density.totalPlayers);
      if (density.contoursUrl) {
        loadContours(density.contoursUrl);
      }
    }

    // 6. Initialize filters (dimension toggles, date, layers)
    initFilters(worldInfo);

    // 7. Initialize search
    initSearch();

    // 8. Initialize player layer — fetches clusters from server per viewport
    initPlayerLayer(worldInfo);
    setPlayerDimension(defaultDim);

    // 9. Add spawn point marker if available
    if (worldInfo.spawn) {
      const spawnIcon = L.divIcon({
        className: 'spawn-marker',
        html: '<div class="spawn-marker-inner"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      const spawnMarker = L.marker(
        L.latLng(worldInfo.spawn.z, worldInfo.spawn.x),
        { icon: spawnIcon, zIndexOffset: 1000 },
      ).addTo(map);
      spawnMarker.bindPopup(
        `<div class="player-popup">
          <div class="popup-name">World Spawn</div>
          <div class="popup-info">X: ${worldInfo.spawn.x}, Z: ${worldInfo.spawn.z}</div>
        </div>`,
      );
      spawnMarker.bindTooltip('Spawn', {
        permanent: true,
        direction: 'top',
        offset: [0, -10],
        className: 'spawn-label',
      });
    }

    // 10. Set up coordinate display on hover
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
