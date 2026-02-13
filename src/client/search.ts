import type { PlayerRecord } from '../shared/protocol';
import { apiUrl } from './api';
import { flyTo, addPlayerMarker, clearPlayerMarkers } from './map';

let searchTimeout: ReturnType<typeof setTimeout>;
const resultsEl = document.getElementById('search-results')!;
const inputEl = document.getElementById('search-input') as HTMLInputElement;

export function initSearch(): void {
  inputEl.addEventListener('input', () => {
    const q = inputEl.value.trim();
    clearTimeout(searchTimeout);

    if (q.length < 1) {
      hideResults();
      return;
    }

    searchTimeout = setTimeout(() => performSearch(q), 250);
  });

  // Close results when clicking outside
  document.addEventListener('click', (e) => {
    if (
      !resultsEl.contains(e.target as Node) &&
      e.target !== inputEl
    ) {
      hideResults();
    }
  });
}

async function performSearch(query: string): Promise<void> {
  try {
    const res = await fetch(
      apiUrl(`/api/players/search?q=${encodeURIComponent(query)}&limit=20`),
    );
    const data = await res.json();
    showResults(data.results);
  } catch (e) {
    console.error('Search failed:', e);
  }
}

function showResults(players: PlayerRecord[]): void {
  resultsEl.innerHTML = '';

  if (players.length === 0) {
    resultsEl.innerHTML =
      '<div class="search-result-item"><em>No results found</em></div>';
    resultsEl.classList.add('visible');
    return;
  }

  for (const p of players) {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.innerHTML = `
      <div class="player-name">${p.name || p.uuid}</div>
      <div class="player-coords">${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)} - ${p.dimension.replace('minecraft:', '')}</div>
    `;

    item.addEventListener('click', () => {
      clearPlayerMarkers();
      addPlayerMarker(p.x, p.z, p.name || '', p.uuid, p.dimension);
      flyTo(p.x, p.z, 3);
      hideResults();
      inputEl.value = p.name || p.uuid;
    });

    resultsEl.appendChild(item);
  }

  resultsEl.classList.add('visible');
}

function hideResults(): void {
  resultsEl.classList.remove('visible');
}
