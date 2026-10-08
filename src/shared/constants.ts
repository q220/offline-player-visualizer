export const DEFAULT_BOUNDS = {
  minX: -500,
  maxX: 500,
  minZ: -500,
  maxZ: 500,
};

export function dimensionSlug(dim: string): string {
  return dim.replace('minecraft:', '');
}
