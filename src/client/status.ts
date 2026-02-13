/**
 * Centralized status bar for showing activity indicators on the map.
 * Other modules call setStatus/clearStatus with a unique key.
 */

interface StatusEntry {
  key: string;
  message: string;
  startTime: number;
}

const entries = new Map<string, StatusEntry>();
let barEl: HTMLDivElement;
let spinnerEl: HTMLDivElement;
let textEl: HTMLSpanElement;
let extraEl: HTMLSpanElement;
let timerEl: HTMLSpanElement;
let tickInterval: ReturnType<typeof setInterval> | null = null;

export function initStatus(): void {
  barEl = document.createElement('div');
  barEl.id = 'status-bar';
  barEl.classList.add('hidden');

  spinnerEl = document.createElement('div');
  spinnerEl.className = 'status-spinner';

  textEl = document.createElement('span');
  textEl.className = 'status-text';

  timerEl = document.createElement('span');
  timerEl.className = 'status-timer';

  extraEl = document.createElement('span');
  extraEl.className = 'status-extra';

  barEl.appendChild(spinnerEl);
  barEl.appendChild(textEl);
  barEl.appendChild(timerEl);
  barEl.appendChild(extraEl);

  document.getElementById('map-container')!.appendChild(barEl);
}

export function setStatus(key: string, message: string): void {
  const existing = entries.get(key);
  if (existing) {
    existing.message = message;
  } else {
    entries.set(key, { key, message, startTime: Date.now() });
  }
  render();
  startTick();
}

export function clearStatus(key: string): void {
  entries.delete(key);
  render();
  if (entries.size === 0) {
    stopTick();
  }
}

function render(): void {
  if (entries.size === 0) {
    barEl.classList.add('hidden');
    return;
  }

  barEl.classList.remove('hidden');

  // Show the most recently added entry
  const all = Array.from(entries.values());
  const latest = all[all.length - 1];

  textEl.textContent = latest.message;

  // Elapsed time
  const elapsed = Math.floor((Date.now() - latest.startTime) / 1000);
  timerEl.textContent = elapsed >= 1 ? `${elapsed}s` : '';

  // Extra count
  if (all.length > 1) {
    extraEl.textContent = `+${all.length - 1} more`;
  } else {
    extraEl.textContent = '';
  }
}

function startTick(): void {
  if (tickInterval) return;
  tickInterval = setInterval(render, 1000);
}

function stopTick(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}
