// NOTE: This worker file is vestigial — player-indexer.ts does inline parsing
// via parseBatch() and does not use worker threads. This file is kept for
// reference but is not loaded at runtime.
import { parentPort, workerData } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { parse } from 'prismarine-nbt';
import type { PlayerRecord } from '../../shared/protocol.js';

interface WorkerInput {
  files: string[];
}

const { files } = workerData as WorkerInput;

async function parsePlayerFiles(): Promise<PlayerRecord[]> {
  const results: PlayerRecord[] = [];

  for (const filePath of files) {
    try {
      const buffer = fs.readFileSync(filePath);
      const stat = fs.statSync(filePath);
      const { parsed } = await parse(buffer);
      const root = parsed.value as any;

      // Extract position
      const pos = root.Pos?.value?.value;
      if (!pos || pos.length < 3) continue;

      const x = pos[0];
      const y = pos[1];
      const z = pos[2];

      // Extract dimension
      let dimension = root.Dimension?.value;
      if (typeof dimension === 'number') {
        // Old format: 0 = overworld, -1 = nether, 1 = end
        switch (dimension) {
          case -1:
            dimension = 'minecraft:the_nether';
            break;
          case 1:
            dimension = 'minecraft:the_end';
            break;
          default:
            dimension = 'minecraft:overworld';
        }
      } else if (typeof dimension !== 'string') {
        dimension = 'minecraft:overworld';
      }

      // UUID from filename
      const uuid = path.basename(filePath, '.dat');

      results.push({
        uuid,
        x,
        y,
        z,
        dimension,
        lastModified: stat.mtimeMs,
        hasHeadItem: false,
      });
    } catch (e) {
      // Skip corrupt files
    }
  }

  return results;
}

parsePlayerFiles().then((players) => {
  parentPort?.postMessage(players);
});
