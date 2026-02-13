import type { WorldInfo } from '../shared/protocol';

export function initSidebar(worldInfo: WorldInfo): void {
  document.getElementById('world-name')!.textContent = worldInfo.name;
  document.getElementById('mc-version')!.textContent = worldInfo.mcVersion;
  document.getElementById('player-count')!.textContent =
    worldInfo.playerCount.toLocaleString();
}
