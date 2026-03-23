import type { WorldInfo, HubMetrics } from '../shared/protocol';
import { DEFAULT_HUB_DATE } from '../shared/protocol';
import { apiUrl } from './api';

export function initSidebar(worldInfo: WorldInfo): void {
  document.getElementById('world-name')!.textContent = worldInfo.name;
  document.getElementById('mc-version')!.textContent = worldInfo.mcVersion;
  document.getElementById('player-count')!.textContent =
    worldInfo.playerCount.toLocaleString();

  const sinceInput = document.getElementById('hub-metrics-since') as HTMLInputElement | null;
  const refreshBtn = document.getElementById('hub-metrics-refresh') as HTMLButtonElement | null;

  fetchHubMetrics(DEFAULT_HUB_DATE);

  if (refreshBtn && sinceInput) {
    refreshBtn.addEventListener('click', () => {
      const since = sinceInput.value
        ? new Date(sinceInput.value).getTime()
        : DEFAULT_HUB_DATE;
      fetchHubMetrics(since);

      // If dropout heatmap is active, re-trigger it
      const dropoutToggle = document.getElementById('toggle-dropout-heatmap') as HTMLInputElement | null;
      if (dropoutToggle && dropoutToggle.checked) {
        dropoutToggle.dispatchEvent(new Event('change'));
      }
    });
  }
}

async function fetchHubMetrics(since: number): Promise<void> {
  try {
    const res = await fetch(apiUrl(`/api/hub-metrics?since=${since}`));
    const data: HubMetrics = await res.json();
    renderHubMetrics(data);
  } catch (e) {
    console.error('Failed to fetch hub metrics:', e);
  }
}

function renderHubMetrics(data: HubMetrics): void {
  const totalEl = document.getElementById('hm-total');
  const headItemEl = document.getElementById('hm-head-item');
  const noHeadItemEl = document.getElementById('hm-no-head-item');
  const singleSessionEl = document.getElementById('hm-single-session');

  if (totalEl) {
    totalEl.textContent = data.totalPlayers.toLocaleString();
  }

  const pct = (n: number) =>
    data.totalPlayers > 0 ? ((n / data.totalPlayers) * 100).toFixed(1) : '0.0';

  // innerHTML is safe here: all values are server-controlled numbers, not user input
  if (headItemEl) {
    headItemEl.innerHTML = `${data.withHeadItem.toLocaleString()}<span class="metric-pct">(${pct(data.withHeadItem)}%)</span>`;
  }
  if (noHeadItemEl) {
    noHeadItemEl.innerHTML = `${data.withoutHeadItem.toLocaleString()}<span class="metric-pct">(${pct(data.withoutHeadItem)}%)</span>`;
  }
  if (singleSessionEl) {
    singleSessionEl.innerHTML = `${data.singleSession.toLocaleString()}<span class="metric-pct">(${pct(data.singleSession)}%)</span>`;
  }
}
