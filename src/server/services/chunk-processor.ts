import { Vec3 } from 'vec3';
import { getBlockColor } from '../data/block-colors.js';

let debugged = false;

/**
 * Extract the top-most non-air block for each column in a chunk.
 * Returns a 16x16 array of RGBA colors.
 */
export function extractTopBlocks(chunk: any): Uint8Array {
  // 16x16 columns, 4 bytes per pixel (RGBA)
  const pixels = new Uint8Array(16 * 16 * 4);

  if (!chunk) {
    return pixels;
  }

  // Debug first chunk to diagnose rendering issues
  if (!debugged) {
    debugged = true;
    console.log('  [debug] Chunk type:', typeof chunk, chunk?.constructor?.name);
    console.log('  [debug] Chunk keys:', Object.keys(chunk).slice(0, 15));
    console.log('  [debug] Has getBlock:', typeof chunk.getBlock);
    console.log('  [debug] Has sections:', typeof chunk.sections, Array.isArray(chunk.sections));
    console.log('  [debug] minY:', chunk.minY, 'maxY:', chunk.maxY);

    // Try reading a few blocks at different heights
    for (const testY of [319, 256, 128, 64, 32, 0, -1, -32, -64]) {
      try {
        const b = chunk.getBlock(new Vec3(0, testY, 0));
        if (b && b.name !== 'air') {
          console.log(`  [debug] y=${testY}: ${b.name} (stateId=${b.stateId})`);
        }
      } catch (e: any) {
        console.log(`  [debug] y=${testY}: ERROR ${e.message}`);
      }
    }

    // Try to find ANY non-air block
    let found = false;
    for (let y = 319; y >= -64 && !found; y--) {
      for (let x = 0; x < 16 && !found; x++) {
        for (let z = 0; z < 16 && !found; z++) {
          try {
            const b = chunk.getBlock(new Vec3(x, y, z));
            if (b && b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'void_air') {
              console.log(`  [debug] Found block at ${x},${y},${z}: ${b.name}`);
              found = true;
            }
          } catch {
            // skip
          }
        }
      }
    }
    if (!found) {
      console.log('  [debug] WARNING: No non-air blocks found in first chunk!');
    }
  }

  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      let color: [number, number, number, number] = [0, 0, 0, 0];

      const maxY = chunk.maxY ?? 320;
      const minY = chunk.minY ?? -64;

      for (let y = maxY - 1; y >= minY; y--) {
        try {
          const block = chunk.getBlock(new Vec3(x, y, z));
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
