import type { WorldInfo } from '../shared/protocol';

declare const L: typeof import('leaflet');

type BoundsRect = { minX: number; maxX: number; minZ: number; maxZ: number };
type BoundsCallback = (bounds: BoundsRect | null) => void;

let map: L.Map;
let areaRect: L.Rectangle | null = null;
let cornerMarkers: L.Marker[] = [];
let drawMode = false;
let drawStart: L.LatLng | null = null;
let callbacks: BoundsCallback[] = [];
let controlEl: HTMLDivElement;
let drawBtn: HTMLButtonElement;
let resetBtn: HTMLButtonElement;

export function initAreaSelect(leafletMap: L.Map, _worldInfo: WorldInfo): void {
  map = leafletMap;

  // Add control to map
  const AreaControl = L.Control.extend({
    onAdd() {
      controlEl = L.DomUtil.create('div', 'area-select-control');

      drawBtn = L.DomUtil.create('button', 'area-select-btn', controlEl) as HTMLButtonElement;
      drawBtn.innerHTML = '&#9634;'; // □ square icon
      drawBtn.title = 'Select area';
      drawBtn.type = 'button';

      resetBtn = L.DomUtil.create('button', 'area-select-btn area-select-reset hidden', controlEl) as HTMLButtonElement;
      resetBtn.innerHTML = '&#10005;'; // ✕ close icon
      resetBtn.title = 'Clear selection';
      resetBtn.type = 'button';

      drawBtn.addEventListener('click', () => {
        if (drawMode) {
          exitDrawMode();
        } else {
          enterDrawMode();
        }
      });

      resetBtn.addEventListener('click', () => {
        clearArea();
      });

      L.DomEvent.disableClickPropagation(controlEl);
      L.DomEvent.disableScrollPropagation(controlEl);
      return controlEl;
    },
  });

  new AreaControl({ position: 'topleft' }).addTo(map);
}

export function onAreaBoundsChange(cb: BoundsCallback): void {
  callbacks.push(cb);
}

export function getAreaBounds(): BoundsRect | null {
  if (!areaRect) return null;
  const b = areaRect.getBounds();
  return {
    minX: Math.floor(b.getWest()),
    maxX: Math.ceil(b.getEast()),
    minZ: Math.floor(b.getSouth()),
    maxZ: Math.ceil(b.getNorth()),
  };
}

export function clearArea(): void {
  removeRect();
  resetBtn.classList.add('hidden');
  fireBoundsChange(null);
}

function enterDrawMode(): void {
  drawMode = true;
  drawBtn.classList.add('active');
  map.dragging.disable();
  map.getContainer().classList.add('draw-mode');

  map.on('mousedown', onDrawStart);
}

function exitDrawMode(): void {
  drawMode = false;
  drawBtn.classList.remove('active');
  map.dragging.enable();
  map.getContainer().classList.remove('draw-mode');

  map.off('mousedown', onDrawStart);
  map.off('mousemove', onDrawMove);
  map.off('mouseup', onDrawEnd);
  drawStart = null;
}

function onDrawStart(e: L.LeafletMouseEvent): void {
  // Remove any existing selection first
  removeRect();
  drawStart = e.latlng;

  areaRect = L.rectangle([drawStart, drawStart], {
    color: '#e94560',
    weight: 2,
    dashArray: '6 4',
    fillColor: '#e94560',
    fillOpacity: 0.1,
    interactive: false,
  }).addTo(map);

  map.on('mousemove', onDrawMove);
  map.on('mouseup', onDrawEnd);
}

function onDrawMove(e: L.LeafletMouseEvent): void {
  if (!drawStart || !areaRect) return;
  areaRect.setBounds(L.latLngBounds(drawStart, e.latlng));
}

function onDrawEnd(e: L.LeafletMouseEvent): void {
  if (!drawStart || !areaRect) return;

  // Finalize bounds
  const finalBounds = L.latLngBounds(drawStart, e.latlng);

  // Reject tiny selections (accidental clicks)
  const size = finalBounds.getNorthEast().distanceTo(finalBounds.getSouthWest());
  if (size < 10) {
    removeRect();
    exitDrawMode();
    return;
  }

  areaRect.setBounds(finalBounds);
  exitDrawMode();
  addCornerHandles();
  resetBtn.classList.remove('hidden');
  fireBoundsChange(getAreaBounds());
}

function addCornerHandles(): void {
  removeCornerHandles();
  if (!areaRect) return;

  const b = areaRect.getBounds();
  const corners = [
    b.getNorthWest(),
    b.getNorthEast(),
    b.getSouthEast(),
    b.getSouthWest(),
  ];

  const cursors = ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize'];

  corners.forEach((pos, i) => {
    const marker = L.marker(pos, {
      draggable: true,
      icon: L.divIcon({
        className: 'corner-handle',
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      }),
      zIndexOffset: 1000,
    });

    // Set per-handle cursor via inline style
    marker.on('add', () => {
      const el = marker.getElement();
      if (el) el.style.cursor = cursors[i];
    });

    marker.on('drag', () => onCornerDrag(i));
    marker.on('dragend', () => fireBoundsChange(getAreaBounds()));

    marker.addTo(map);
    cornerMarkers.push(marker);
  });
}

function onCornerDrag(draggedIdx: number): void {
  if (!areaRect || cornerMarkers.length !== 4) return;

  // Opposite corner stays fixed
  const oppositeIdx = (draggedIdx + 2) % 4;
  const dragged = cornerMarkers[draggedIdx].getLatLng();
  const opposite = cornerMarkers[oppositeIdx].getLatLng();

  // Compute new bounds from dragged + opposite
  const newBounds = L.latLngBounds(dragged, opposite);
  areaRect.setBounds(newBounds);

  // Update the other two corners to match
  const nw = newBounds.getNorthWest();
  const ne = newBounds.getNorthEast();
  const se = newBounds.getSouthEast();
  const sw = newBounds.getSouthWest();
  const positions = [nw, ne, se, sw];

  cornerMarkers.forEach((m, i) => {
    if (i !== draggedIdx) {
      m.setLatLng(positions[i]);
    }
  });
}

function removeCornerHandles(): void {
  for (const m of cornerMarkers) {
    map.removeLayer(m);
  }
  cornerMarkers = [];
}

function removeRect(): void {
  removeCornerHandles();
  if (areaRect) {
    map.removeLayer(areaRect);
    areaRect = null;
  }
}

function fireBoundsChange(bounds: BoundsRect | null): void {
  for (const cb of callbacks) {
    cb(bounds);
  }
}
