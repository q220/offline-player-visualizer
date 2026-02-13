export const DEFAULT_BOUNDS = {
  minX: -500,
  maxX: 500,
  minZ: -500,
  maxZ: 500,
};

export const WORLD_SIZE = 1000;

export const DIMENSIONS = [
  'minecraft:overworld',
  'minecraft:the_nether',
  'minecraft:the_end',
] as const;

export type DimensionId = (typeof DIMENSIONS)[number];

export function dimensionSlug(dim: string): string {
  return dim.replace('minecraft:', '');
}
