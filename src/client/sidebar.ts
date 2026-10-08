import type { WorldInfo } from '../shared/protocol';

export function initSidebar(worldInfo: WorldInfo): void {
  document.getElementById('world-name')!.textContent = worldInfo.name;
  document.getElementById('mc-version')!.textContent = worldInfo.mcVersion;
  document.getElementById('player-count')!.textContent =
    worldInfo.playerCount.toLocaleString();

  // The dropout heatmap follows its own date; re-render it when the date changes
  const sinceInput = document.getElementById('dropout-since') as HTMLInputElement | null;
  sinceInput?.addEventListener('change', () => {
    const dropoutToggle = document.getElementById('toggle-dropout-heatmap') as HTMLInputElement | null;
    if (dropoutToggle?.checked) dropoutToggle.dispatchEvent(new Event('change'));
  });
}
