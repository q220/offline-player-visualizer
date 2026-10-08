export const DEFAULT_BOUNDS = {
  minX: -500,
  maxX: 500,
  minZ: -500,
  maxZ: 500,
};

export function dimensionSlug(dim: string): string {
  return dim.replace('minecraft:', '');
}

/** ViaVersion's names for recent protocol numbers (as in ViaVersion 5.12) */
const CLIENT_VERSIONS: Record<number, string> = {
  762: '1.19.4', 763: '1.20–1.20.1', 764: '1.20.2', 765: '1.20.3–1.20.4', 766: '1.20.5–1.20.6',
  767: '1.21–1.21.1', 768: '1.21.2–1.21.3', 769: '1.21.4', 770: '1.21.5', 771: '1.21.6',
  772: '1.21.7–1.21.8', 773: '1.21.9–1.21.10', 774: '1.21.11', 775: '26.1–26.1.2',
  776: '26.2', 777: '26.3',
};

/** The client's game version; protocols newer than the table show as their number */
export function clientVersionName(protocol: number): string {
  return CLIENT_VERSIONS[protocol] ?? (protocol < 762 ? 'Older than 1.19.4' : `Protocol ${protocol}`);
}
