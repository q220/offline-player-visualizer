/// <reference types="vite/client" />
// Resolve URLs relative to the Vite base path so the app works under a subpath
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export function apiUrl(path: string): string {
  return `${base}${path}`;
}
