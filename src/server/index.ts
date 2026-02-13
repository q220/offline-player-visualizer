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

  // 4. Pre-render block map tiles and heatmaps
  for (const dimension of worldInfo.dimensions) {
    const hasRegions = listRegionFiles(worldPath, dimension).length > 0;
    if (hasRegions) {
      try {
        console.log(`Rendering tiles for ${dimension}...`);
        await renderBlockMap(worldPath, dimension, worldInfo.mcVersion);
      } catch (e) {
        console.error(`  Failed to render tiles for ${dimension}:`, e);
      }
    } else {
      console.log(`No region files for ${dimension}, skipping tile render`);
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

  // Sharp pixel limit is ~268M pixels. Cap to 16384x16384 = 268M to stay safe.
  // Memory: 16384^2 * 4 bytes = 1GB for pixel buffer alone, so use a practical cap.
  const MAX_MAP_SIZE = 10000; // 10000x10000 = 100M pixels, ~400MB pixel buffer

  // Include region file coverage (each region = 32 chunks = 512 blocks)
  let regionMinX = Infinity, regionMaxX = -Infinity;
  let regionMinZ = Infinity, regionMaxZ = -Infinity;
  for (const dim of worldInfo.dimensions) {
    const regionFiles = listRegionFiles(worldPath, dim);
    for (const f of regionFiles) {
      const coords = parseRegionCoords(f);
      if (coords) {
        const rMinX = coords.rx * 512;
        const rMaxX = rMinX + 512;
        const rMinZ = coords.rz * 512;
        const rMaxZ = rMinZ + 512;
        if (rMinX < regionMinX) regionMinX = rMinX;
        if (rMaxX > regionMaxX) regionMaxX = rMaxX;
        if (rMinZ < regionMinZ) regionMinZ = rMinZ;
        if (rMaxZ > regionMaxZ) regionMaxZ = rMaxZ;
      }
    }
  }

  if (isFinite(regionMinX)) {
    console.log(`  Region file coverage: X[${regionMinX}..${regionMaxX}] Z[${regionMinZ}..${regionMaxZ}] (${regionMaxX - regionMinX}x${regionMaxZ - regionMinZ})`);
    minX = regionMinX; maxX = regionMaxX;
    minZ = regionMinZ; maxZ = regionMaxZ;
  }

  // Include player positions
  const allPlayers = playerStore.getAll().players;

  // Log player position distribution per dimension
  const dimStats = new Map<string, { count: number; minX: number; maxX: number; minZ: number; maxZ: number }>();
  for (const p of allPlayers) {
    let stats = dimStats.get(p.dimension);
    if (!stats) {
      stats = { count: 0, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      dimStats.set(p.dimension, stats);
    }
    stats.count++;
    if (p.x < stats.minX) stats.minX = p.x;
    if (p.x > stats.maxX) stats.maxX = p.x;
    if (p.z < stats.minZ) stats.minZ = p.z;
    if (p.z > stats.maxZ) stats.maxZ = p.z;
  }
  for (const [dim, stats] of dimStats) {
    console.log(`  Player positions [${dim}]: ${stats.count} players, X[${Math.floor(stats.minX)}..${Math.ceil(stats.maxX)}] Z[${Math.floor(stats.minZ)}..${Math.ceil(stats.maxZ)}]`);
  }

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

  // Final size cap — if bounds exceed MAX_MAP_SIZE, shrink to fit centered on the region area
  const computedWidth = maxX - minX;
  const computedHeight = maxZ - minZ;
  if (computedWidth > MAX_MAP_SIZE || computedHeight > MAX_MAP_SIZE) {
    const centerX = isFinite(regionMinX)
      ? (regionMinX + regionMaxX) / 2
      : (minX + maxX) / 2;
    const centerZ = isFinite(regionMinZ)
      ? (regionMinZ + regionMaxZ) / 2
      : (minZ + maxZ) / 2;

    // Keep whichever dimension is under the cap, shrink the other(s)
    const capW = Math.min(computedWidth, MAX_MAP_SIZE);
    const capH = Math.min(computedHeight, MAX_MAP_SIZE);

    console.log(`  Bounds too large (${computedWidth}x${computedHeight}), capping to ${capW}x${capH} centered on region area`);

    minX = Math.floor((centerX - capW / 2) / 16) * 16;
    maxX = minX + Math.ceil(capW / 16) * 16;
    minZ = Math.floor((centerZ - capH / 2) / 16) * 16;
    maxZ = minZ + Math.ceil(capH / 16) * 16;
  }

  console.log(`Dynamic bounds: X[${minX}..${maxX}] Z[${minZ}..${maxZ}] (${maxX - minX}x${maxZ - minZ} pixels)\n`);

  // Update config and worldInfo
  config.bounds = { minX, maxX, minZ, maxZ };
  worldInfo.bounds = { minX, maxX, minZ, maxZ };
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
