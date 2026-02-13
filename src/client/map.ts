import type { WorldInfo, ContourData } from '../shared/protocol';
import { apiUrl } from './api';

declare const L: typeof import('leaflet');

let map: L.Map;
let blockMapLayer: L.GridLayer | null = null;
let heatmapLayer: L.ImageOverlay | null = null;
let playerMarkerLayer: L.LayerGroup;
let legendControl: L.Control | null = null;
let contourLayer: L.LayerGroup | null = null;

export function initMap(worldInfo: WorldInfo): L.Map {
  const { minX, maxX, minZ, maxZ } = worldInfo.bounds;

  // Create bounds for CRS.Simple: [lat, lng] = [z, x] in Minecraft terms
  const southWest = L.latLng(minZ, minX);
  const northEast = L.latLng(maxZ, maxX);
  const bounds = L.latLngBounds(southWest, northEast);

  map = L.map('map', {
    crs: L.CRS.Simple,
    minZoom: -5,
    maxZoom: 5,
    zoomSnap: 0.5,
    attributionControl: false,
  });

  map.fitBounds(bounds);

  playerMarkerLayer = L.layerGroup().addTo(map);

  return map;
}

/**
 * Set the block map layer for a dimension using per-region tiles.
 * Tiles are 512x512 px, one per region file.
 * Tile coords map to Leaflet GridLayer coords:
 *   tx = coords.x, ty = coords.y (server handles the Y-flip)
 */
export function setBlockMap(dimension: string, _worldInfo: WorldInfo): void {
  const slug = dimension.replace('minecraft:', '');

  if (blockMapLayer) {
    map.removeLayer(blockMapLayer);
  }

  const RegionTileLayer = L.GridLayer.extend({
    createTile(coords: L.Coords) {
      const tile = document.createElement('img') as HTMLImageElement;
      tile.crossOrigin = '';
      tile.style.width = '512px';
      tile.style.height = '512px';

      const url = apiUrl(`/api/tiles/${slug}/${coords.x}/${coords.y}.png`);
      tile.src = url;

      // If tile doesn't exist (no region file), show nothing
      tile.onerror = () => {
        tile.style.display = 'none';
      };

      return tile;
    },
  });

  blockMapLayer = new RegionTileLayer({
    tileSize: 512,
    maxNativeZoom: 0,
    minNativeZoom: 0,
    minZoom: -5,
    maxZoom: 5,
    noWrap: true,
    keepBuffer: 4,
    updateWhenZooming: false,
  }).addTo(map);
}

export function setHeatmap(
  url: string,
  worldInfo: WorldInfo,
): void {
  const { minX, maxX, minZ, maxZ } = worldInfo.bounds;
  const bounds: L.LatLngBoundsExpression = [
    [minZ, minX],
    [maxZ, maxX],
  ];

  if (heatmapLayer) {
    map.removeLayer(heatmapLayer);
  }

  heatmapLayer = L.imageOverlay(`${url}?t=${Date.now()}`, bounds, {
    opacity: 0.7,
    zIndex: 2,
  }).addTo(map);
}

export function toggleBlockMapVisibility(visible: boolean): void {
  if (blockMapLayer) {
    if (visible) {
      blockMapLayer.addTo(map);
    } else {
      map.removeLayer(blockMapLayer);
    }
  }
}

export function toggleHeatmapVisibility(visible: boolean): void {
  if (heatmapLayer) {
    if (visible) {
      heatmapLayer.addTo(map);
    } else {
      map.removeLayer(heatmapLayer);
    }
  }
  if (contourLayer) {
    if (visible) {
      contourLayer.addTo(map);
    } else {
      map.removeLayer(contourLayer);
    }
  }
}

export function flyTo(x: number, z: number, zoom = 3): void {
  map.flyTo(L.latLng(z, x), zoom, { duration: 0.8 });
}

export function addPlayerMarker(
  x: number,
  z: number,
  name: string,
  uuid: string,
  dimension: string,
): L.Marker {
  const marker = L.marker(L.latLng(z, x), {
    title: name || uuid,
  });

  const dimName = dimension.replace('minecraft:', '').replace('the_', '');
  marker.bindPopup(
    `<div class="player-popup">
      <div class="popup-name">${name || 'Unknown'}</div>
      <div class="popup-info">UUID: ${uuid}</div>
      <div class="popup-info">Position: ${Math.round(x)}, ${Math.round(z)}</div>
      <div class="popup-info">Dimension: ${dimName}</div>
    </div>`,
  );

  marker.addTo(playerMarkerLayer);
  return marker;
}

export function clearPlayerMarkers(): void {
  playerMarkerLayer.clearLayers();
}

export async function loadContours(contoursUrl: string): Promise<void> {
  try {
    const res = await fetch(apiUrl(`${contoursUrl}?t=${Date.now()}`));
    if (!res.ok) return;
    const data: ContourData = await res.json();
    setContourLines(data);
  } catch (e) {
    console.warn('Failed to load contour data:', e);
  }
}

export function setContourLines(data: ContourData): void {
  if (contourLayer) {
    map.removeLayer(contourLayer);
  }

  contourLayer = L.layerGroup();

  for (const level of data.levels) {
    const label = level.value >= 1000
      ? `${(level.value / 1000).toFixed(1)}k`
      : `${level.value}`;

    for (const line of level.lines) {
      // Convert [x, z] to Leaflet [lat, lng] = [z, x]
      const latlngs = line.map(([x, z]) => L.latLng(z, x));

      // Draw the contour polyline
      const polyline = L.polyline(latlngs, {
        color: 'rgba(255, 255, 255, 0.6)',
        weight: 1.5,
        dashArray: '4 4',
        interactive: false,
      });
      contourLayer.addLayer(polyline);

      // Place density label at midpoint of polyline
      if (latlngs.length >= 2) {
        const midIdx = Math.floor(latlngs.length / 2);
        const midPoint = latlngs[midIdx];

        const marker = L.marker(midPoint, {
          icon: L.divIcon({
            className: 'contour-label',
            html: `<span>${label}</span>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
          interactive: false,
          zIndexOffset: -100,
        });
        contourLayer.addLayer(marker);

        // For long polylines, add extra labels
        const totalPts = latlngs.length;
        if (totalPts > 20) {
          const step = Math.floor(totalPts / 3);
          for (const idx of [step, totalPts - step]) {
            const pt = latlngs[idx];
            const extra = L.marker(pt, {
              icon: L.divIcon({
                className: 'contour-label',
                html: `<span>${label}</span>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0],
              }),
              interactive: false,
              zIndexOffset: -100,
            });
            contourLayer.addLayer(extra);
          }
        }
      }
    }
  }

  contourLayer.addTo(map);
}

export function getMap(): L.Map {
  return map;
}

export function setHeatmapLegend(maxPerChunk: number, totalPlayers: number): void {
  if (legendControl) {
    map.removeControl(legendControl);
  }

  if (maxPerChunk <= 0) return;

  const LegendControl = L.Control.extend({
    onAdd() {
      const div = L.DomUtil.create('div', 'heatmap-legend');

      // Color gradient bar (matches heatmapColor in heatmap-renderer.ts)
      const stops = [
        'rgba(0,0,100,0.24)',   // 0.005 - low
        'rgba(0,80,255,0.37)',  // 0.25
        'rgba(0,255,255,0.50)', // 0.50
        'rgba(255,255,0,0.63)', // 0.75
        'rgba(255,0,0,0.78)',   // 1.0 - high
      ];

      const gradientBar = `linear-gradient(to right, ${stops.join(', ')})`;

      div.innerHTML = `
        <div class="legend-title">Player Density</div>
        <div class="legend-bar" style="background: ${gradientBar};"></div>
        <div class="legend-labels">
          <span>0</span>
          <span>${maxPerChunk} / chunk</span>
        </div>
        <div class="legend-total">${totalPlayers.toLocaleString()} players total</div>
      `;

      L.DomEvent.disableClickPropagation(div);
      return div;
    },
  });

  legendControl = new LegendControl({ position: 'bottomright' });
  legendControl.addTo(map);
}
