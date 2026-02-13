import { getBlockColor } from '../data/block-colors.js';

/**
 * Extract the top-most non-air block for each column in a chunk.
 * Returns a 16x16 array of RGBA colors.
 */
export function extractTopBlocks(chunk: any): Uint8Array {
  // 16x16 columns, 4 bytes per pixel (RGBA)
  const pixels = new Uint8Array(16 * 16 * 4);

  if (!chunk) {
    // Transparent for missing chunks
    return pixels;
  }

  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      let color: [number, number, number, number] = [0, 0, 0, 0];

      // Scan from top to bottom to find first non-air block
      // Modern chunks can go from -64 to 320 (384 blocks), older from 0 to 255
      const maxY = chunk.maxY ?? 320;
      const minY = chunk.minY ?? -64;

      for (let y = maxY - 1; y >= minY; y--) {
        try {
          const block = chunk.getBlock({ x, y, z } as any);
          if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
            color = getBlockColor(block.name);
            break;
          }
        } catch {
          continue;
        }
      }

      const idx = (z * 16 + x) * 4;
      pixels[idx] = color[0];
      pixels[idx + 1] = color[1];
      pixels[idx + 2] = color[2];
      pixels[idx + 3] = color[3];
    }
  }

  return pixels;
}
