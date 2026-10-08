import path from 'path';
import crypto from 'crypto';
import { DEFAULT_BOUNDS } from '../shared/constants.js';

const worldPath = path.resolve(process.argv[2] || './world');

// Caches are kept per world so tiles or players of one world never show up in another
const worldKey = `${path.basename(worldPath)}-${crypto.createHash('sha1').update(worldPath).digest('hex').slice(0, 8)}`;

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '127.0.0.1',
  worldPath,
  cacheDir: path.resolve('.cache', worldKey),
  bounds: { ...DEFAULT_BOUNDS },
};
