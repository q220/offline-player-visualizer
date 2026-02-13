import { Vec3 } from 'vec3';
import { getBlockColor } from '../data/block-colors.js';

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

  // Quick skip: if all sections have solidBlockCount === 0, chunk is empty
  if (Array.isArray(chunk.sections)) {
    const hasBlocks = chunk.sections.some(
      (s: any) => s && s.solidBlockCount > 0,
    );
    if (!hasBlocks) return pixels;
  }

  const minY = chunk.minY ?? -64;
  const maxY = chunk.maxY ?? (chunk.worldHeight ? minY + chunk.worldHeight : 320);

  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      let color: [number, number, number, number] = [0, 0, 0, 0];

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

/**
 * Debug a specific chunk - log section contents.
 */
export function debugChunk(chunk: any, label: string): void {
  if (!chunk) {
    console.log(`  [debug] ${label}: chunk is null`);
    return;
  }

  console.log(`  [debug] ${label}: minY=${chunk.minY} worldHeight=${chunk.worldHeight}`);

  if (Array.isArray(chunk.sections)) {
    let emptySections = 0;
    let filledSections = 0;
    for (let i = 0; i < chunk.sections.length; i++) {
      const sec = chunk.sections[i];
      if (!sec || sec.solidBlockCount === 0) {
        emptySections++;
      } else {
        filledSections++;
        const sectionY = (chunk.minY ?? -64) + i * 16;
        console.log(`  [debug]   Section ${i} (y=${sectionY}): solidBlockCount=${sec.solidBlockCount}`);
        if (sec.palette) {
          const names = sec.palette.map((p: any) =>
            typeof p === 'number' ? `stateId:${p}` : (p?.name || JSON.stringify(p).slice(0, 60)),
          );
          console.log(`  [debug]     palette(${sec.palette.length}):`, names.slice(0, 10));
        }
        if (sec.data?.get) {
          const vals = new Set<number>();
          for (let j = 0; j < 4096; j++) vals.add(sec.data.get(j));
          console.log(`  [debug]     unique data values:`, [...vals].slice(0, 20));
        }
      }
    }
    console.log(`  [debug]   ${filledSections} filled / ${emptySections} empty sections`);
  }

  // Try getBlock at y=64
  try {
    const b = chunk.getBlock(new Vec3(8, 64, 8));
    console.log(`  [debug]   getBlock(8,64,8) = ${b?.name} stateId=${b?.stateId}`);
  } catch (e: any) {
    console.log(`  [debug]   getBlock error: ${e.message}`);
  }
}
