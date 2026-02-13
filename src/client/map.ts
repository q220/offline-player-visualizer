import type { WorldInfo } from '../shared/protocol';
import { apiUrl } from './api';

declare const L: typeof import('leaflet');

let map: L.Map;
let blockMapLayer: L.GridLayer | null = null;
let heatmapLayer: L.ImageOverlay | null = null;
let playerMarkerLayer: L.LayerGroup;

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

      const url = apiUrl(`/static/tiles/${slug}/${coords.x}.${coords.y}.png`);
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

export function getMap(): L.Map {
  return map;
}
