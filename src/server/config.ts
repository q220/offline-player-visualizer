import path from 'path';
import os from 'os';
import { DEFAULT_BOUNDS } from '../shared/constants.js';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: '0.0.0.0',
  worldPath: process.argv[2] || './world',
  staticDir: path.resolve('dist/static'),
  bounds: { ...DEFAULT_BOUNDS },
  heatmap: {
    blurSigma: 4,
    opacity: 0.6,
    width: 1000,
    height: 1000,
  },
  playerIndexing: {
    batchSize: 500,
    maxWorkers: Math.min(4, Math.max(1, os.cpus().length - 1)),
  },
};
