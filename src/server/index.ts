import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import fastifyCompress from '@fastify/compress';
import path from 'path';
import fs from 'fs';
import { config } from './config.js';
import { scanWorld } from './services/world-scanner.js';
import { indexPlayers } from './services/player-indexer.js';
import { playerStore } from './services/player-store.js';
import { renderBlockMap } from './services/map-renderer.js';
import { renderHeatmap } from './services/heatmap-renderer.js';
import { listRegionFiles, parseRegionCoords } from './services/region-loader.js';
import { registerApiRoutes } from './routes/api.js';

async function main() {
  const worldPath = config.worldPath;
  console.log(`\nMinecraft Offline Player Visualizer`);
  console.log(`World path: ${path.resolve(worldPath)}\n`);

  // 1. Scan world structure
  console.log('Scanning world structure...');
  const worldInfo = await scanWorld(worldPath);
  console.log(`  World: ${worldInfo.name}`);
  console.log(`  MC Version: ${worldInfo.mcVersion}`);
  console.log(`  Dimensions: ${worldInfo.dimensions.join(', ')}`);
  console.log(`  Player files: ${worldInfo.playerCount}`);
  if (worldInfo.spawn) {
    console.log(`  Spawn: ${worldInfo.spawn.x}, ${worldInfo.spawn.z}`);
  }
  console.log();

  // 2. Try loading player cache, otherwise index fresh
  const cacheFile = path.join(path.resolve(worldPath), '.player-index-cache.json');
  let cacheLoaded = false;

  if (fs.existsSync(cacheFile)) {
    try {
      console.log('Loading player index cache...');
      const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      if (Array.isArray(cacheData) && cacheData.length > 0) {
        playerStore.addAll(cacheData);
        console.log(`  Loaded ${playerStore.count} players from cache\n`);
        cacheLoaded = true;
      }
    } catch (e) {
      console.warn('  Cache invalid, will re-index\n');
    }
  }

  if (!cacheLoaded) {
    console.log('Indexing players...');
    const players = await indexPlayers(worldPath, (progress) => {
      process.stdout.write(
        `\r  Progress: ${progress.processed}/${progress.total} (${progress.percent}%)`,
      );
    });
    process.stdout.write('\n');
    playerStore.addAll(players);
    console.log(`  Indexed ${playerStore.count} players\n`);

    // Cache for next startup
    try {
      const allPlayers = playerStore.getAll().players;
      fs.writeFileSync(cacheFile, JSON.stringify(allPlayers));
      console.log(`  Saved player cache to ${cacheFile}\n`);
    } catch (e) {
      console.warn('  Failed to save cache:', e);
    }
  }

  // 3. Collect all dimensions and compute dynamic bounds
  const allDimensions = new Set<string>(worldInfo.dimensions);
  for (const dim of playerStore.getDimensions()) {
    allDimensions.add(dim);
  }
  worldInfo.dimensions = Array.from(allDimensions);
  console.log(`All dimensions: ${worldInfo.dimensions.join(', ')}`);

  // Compute bounds from region files + player positions
  computeDynamicBounds(worldPath, worldInfo);

  // 4. Pre-render block maps and heatmaps
  for (const dimension of worldInfo.dimensions) {
    const hasRegions = listRegionFiles(worldPath, dimension).length > 0;
    if (hasRegions) {
      try {
        console.log(`Rendering block map for ${dimension}...`);
        await renderBlockMap(worldPath, dimension, worldInfo.mcVersion);
      } catch (e) {
        console.error(`  Failed to render block map for ${dimension}:`, e);
        await createPlaceholderMap(dimension);
      }
    } else {
      console.log(`No region files for ${dimension}, creating placeholder map`);
      await createPlaceholderMap(dimension);
    }

    try {
      console.log(`Rendering heatmap for ${dimension}...`);
      await renderHeatmap(dimension);
    } catch (e) {
      console.error(`  Failed to render heatmap for ${dimension}:`, e);
    }
  }

  // 5. Start Fastify server
  const app = Fastify({ logger: false });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyCompress);

  // Serve client build as root
  const clientDir = path.resolve('dist/client');
  if (fs.existsSync(clientDir)) {
    await app.register(fastifyStatic, {
      root: clientDir,
      prefix: '/',
    });
  }

  // Serve static files (pre-rendered maps)
  fs.mkdirSync(config.staticDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: config.staticDir,
    prefix: '/static/',
    decorateReply: false,
  });

  // API routes
  await registerApiRoutes(app, worldInfo);

  // Start
  await app.listen({ port: config.port, host: config.host });
  console.log(`\nServer running at http://localhost:${config.port}`);
  console.log(`  Players loaded: ${playerStore.count}`);
  console.log(`  Dimensions: ${worldInfo.dimensions.join(', ')}`);
  console.log(`  Bounds: X[${config.bounds.minX}..${config.bounds.maxX}] Z[${config.bounds.minZ}..${config.bounds.maxZ}] (${config.bounds.maxX - config.bounds.minX}x${config.bounds.maxZ - config.bounds.minZ})`);
}

/**
 * Compute map bounds from region files and player positions.
 * Updates config.bounds and worldInfo.bounds to cover everything.
 */
function computeDynamicBounds(worldPath: string, worldInfo: import('../shared/protocol.js').WorldInfo): void {
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  // Include region file coverage (each region = 32 chunks = 512 blocks)
  for (const dim of worldInfo.dimensions) {
    const regionFiles = listRegionFiles(worldPath, dim);
    for (const f of regionFiles) {
      const coords = parseRegionCoords(f);
      if (coords) {
        const rMinX = coords.rx * 512;
        const rMaxX = rMinX + 512;
        const rMinZ = coords.rz * 512;
        const rMaxZ = rMinZ + 512;
        if (rMinX < minX) minX = rMinX;
        if (rMaxX > maxX) maxX = rMaxX;
        if (rMinZ < minZ) minZ = rMinZ;
        if (rMaxZ > maxZ) maxZ = rMaxZ;
      }
    }
  }

  // Include all player positions (with padding)
  const allPlayers = playerStore.getAll().players;
  for (const p of allPlayers) {
    if (p.x < minX) minX = Math.floor(p.x);
    if (p.x > maxX) maxX = Math.ceil(p.x);
    if (p.z < minZ) minZ = Math.floor(p.z);
    if (p.z > maxZ) maxZ = Math.ceil(p.z);
  }

  // Fallback if no data at all
  if (!isFinite(minX)) {
    minX = -500; maxX = 500; minZ = -500; maxZ = 500;
  }

  // Add padding (5% or at least 50 blocks)
  const padX = Math.max(50, Math.round((maxX - minX) * 0.05));
  const padZ = Math.max(50, Math.round((maxZ - minZ) * 0.05));
  minX -= padX;
  maxX += padX;
  minZ -= padZ;
  maxZ += padZ;

  // Round to chunk boundaries (16 blocks)
  minX = Math.floor(minX / 16) * 16;
  maxX = Math.ceil(maxX / 16) * 16;
  minZ = Math.floor(minZ / 16) * 16;
  maxZ = Math.ceil(maxZ / 16) * 16;

  console.log(`Dynamic bounds: X[${minX}..${maxX}] Z[${minZ}..${maxZ}] (${maxX - minX}x${maxZ - minZ} pixels)\n`);

  // Update config and worldInfo
  config.bounds = { minX, maxX, minZ, maxZ };
  worldInfo.bounds = { minX, maxX, minZ, maxZ };
}

async function createPlaceholderMap(dimension: string): Promise<void> {
  const sharp = (await import('sharp')).default;
  const { minX, maxX, minZ, maxZ } = config.bounds;
  const width = maxX - minX;
  const height = maxZ - minZ;
  const slug = dimension.replace('minecraft:', '');

  fs.mkdirSync(config.staticDir, { recursive: true });

  // Dark gray placeholder
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = 30;
    pixels[i * 4 + 1] = 30;
    pixels[i * 4 + 2] = 30;
    pixels[i * 4 + 3] = 255;
  }

  const outPath = path.join(config.staticDir, `map-${slug}.png`);
  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(outPath);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
