/// <reference types="vite/client" />
import type { HeatmapRenderResponse } from '../shared/protocol';

// Resolve URLs relative to the Vite base path so the app works under a subpath
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export function apiUrl(path: string): string {
  return `${base}${path}`;
}

/** POST a heatmap render request; throws on an error response */
export async function requestHeatmap(
  path: string,
  body: object,
  signal?: AbortSignal,
): Promise<HeatmapRenderResponse> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
