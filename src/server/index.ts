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
import { renderHeatmap } from './services/heatmap-renderer.js';
import { preRenderTiles } from './services/map-renderer.js';
import { listRegionFiles, scanRegions, type RegionInfo } from './services/region-loader.js';
import { registerApiRoutes } from './routes/api.js';
import { DEFAULT_PLAYER_DAYS } from '../shared/protocol.js';

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
  const dimensionRegions = computeDynamicBounds(worldPath, worldInfo);

  // 4. Pre-render heatmaps (with default 30-day filter to match client default)
  const defaultAfterDate = Date.now() - DEFAULT_PLAYER_DAYS * 24 * 60 * 60 * 1000;
  worldInfo.heatmapDensity = {};
  for (const dimension of worldInfo.dimensions) {
    const hasRegions = listRegionFiles(worldPath, dimension).length > 0;
    if (!hasRegions) {
      console.log(`No region files for ${dimension}, skipping`);
    }

    try {
      console.log(`Rendering heatmap for ${dimension} (last ${DEFAULT_PLAYER_DAYS} days)...`);
      const result = await renderHeatmap(dimension, { afterDate: defaultAfterDate });
      worldInfo.heatmapDensity[dimension] = {
        maxPerChunk: result.maxPerChunk,
        totalPlayers: result.totalPlayers,
        contoursUrl: result.contoursUrl,
      };
    } catch (e) {
      console.error(`  Failed to render heatmap for ${dimension}:`, e);
    }
  }

  // 5. Pre-render block map tiles
  for (const dimension of worldInfo.dimensions) {
    const regions = dimensionRegions.get(dimension);
    if (!regions || regions.length === 0) continue;

    const t0 = performance.now();
    console.log(`Pre-rendering tiles for ${dimension} (${regions.length} regions)...`);

    const stats = await preRenderTiles(worldPath, dimension, regions, (done, total) => {
      process.stdout.write(`\r  Tiles: ${done}/${total}`);
    });
    process.stdout.write('\n');

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    const parts = [];
    if (stats.rendered > 0) parts.push(`${stats.rendered} rendered`);
    if (stats.cached > 0) parts.push(`${stats.cached} cached`);
    if (stats.failed > 0) parts.push(`${stats.failed} failed`);
    console.log(`  ${parts.join(', ')} in ${elapsed}s`);
  }

  // 6. Start Fastify server
  const app = Fastify({ logger: false });

  // Request logging with timing — tile requests are aggregated to avoid noise
  let tileStats = { count: 0, errors: 0, totalMs: 0 };
  let tileFlushTimer: ReturnType<typeof setInterval> | null = null;

  function flushTileStats(): void {
    if (tileStats.count === 0) return;
    const avg = (tileStats.totalMs / tileStats.count).toFixed(1);
    const errStr = tileStats.errors > 0 ? `, ${tileStats.errors} errors` : '';
    console.log(`  [tiles] ${tileStats.count} served (avg ${avg}ms${errStr})`);
    tileStats = { count: 0, errors: 0, totalMs: 0 };
  }

  app.addHook('onRequest', (req, _reply, done) => {
    (req as any)._startTime = performance.now();
    done();
  });
  app.addHook('onResponse', (req, reply, done) => {
    const start = (req as any)._startTime as number;
    const ms = performance.now() - start;
    const url = req.url;

    if (url.startsWith('/api/tiles/')) {
      // Aggregate tile requests into periodic summaries
      tileStats.count++;
      tileStats.totalMs += ms;
      if (reply.statusCode >= 400) tileStats.errors++;
      if (!tileFlushTimer) {
        tileFlushTimer = setInterval(() => {
          flushTileStats();
          if (tileStats.count === 0) {
            clearInterval(tileFlushTimer!);
            tileFlushTimer = null;
          }
        }, 3000);
      }
    } else if (url.startsWith('/api/')) {
      console.log(`  ${req.method} ${url} → ${reply.statusCode} (${ms.toFixed(1)}ms)`);
    }
    done();
  });

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
 * Uses chunk density analysis to exclude sparse/corrupt regions.
 * Centers the bounds on the player centroid so the heatmap covers
 * where players actually are (not just where terrain exists).
 * Returns a map of dimension → RegionInfo[] for tile pre-rendering.
 */
function computeDynamicBounds(
  worldPath: string,
  worldInfo: import('../shared/protocol.js').WorldInfo,
): Map<string, RegionInfo[]> {
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  // Sharp pixel limit is ~268M pixels. Cap to 16384x16384 = 268M to stay safe.
  const MAX_MAP_SIZE = 10000; // 10000x10000 = 100M pixels, ~400MB pixel buffer

  // Minimum chunks for a region to be considered "substantial" (~3% of 1024 max)
  const MIN_CHUNKS_THRESHOLD = 32;

  // Scan regions with chunk density analysis
  const dimensionRegions = new Map<string, RegionInfo[]>();
  let regionMinX = Infinity, regionMaxX = -Infinity;
  let regionMinZ = Infinity, regionMaxZ = -Infinity;

  for (const dim of worldInfo.dimensions) {
    const regions = scanRegions(worldPath, dim);
    dimensionRegions.set(dim, regions);
    if (regions.length === 0) continue;

    // Sort by chunk count descending for logging
    regions.sort((a, b) => b.chunks - a.chunks);

    const totalChunks = regions.reduce((sum, r) => sum + r.chunks, 0);
    const substantial = regions.filter(r => r.chunks >= MIN_CHUNKS_THRESHOLD);
    const sparse = regions.length - substantial.length;
    const substantialChunks = substantial.reduce((sum, r) => sum + r.chunks, 0);

    console.log(`  Region density [${dim}]: ${regions.length} regions, ${totalChunks} total chunks`);
    console.log(`    Substantial (>=${MIN_CHUNKS_THRESHOLD} chunks): ${substantial.length} regions, ${substantialChunks} chunks`);
    if (sparse > 0) {
      const sparseChunks = totalChunks - substantialChunks;
      console.log(`    Sparse/corrupt (<${MIN_CHUNKS_THRESHOLD} chunks): ${sparse} regions, ${sparseChunks} chunks — excluded from bounds`);
    }

    // Log distribution: top 5 and bottom 5
    if (regions.length > 0) {
      const top = regions.slice(0, Math.min(5, regions.length));
      const topStr = top.map(r => `r.${r.rx}.${r.rz}=${r.chunks}`).join(', ');
      console.log(`    Densest: ${topStr}`);

      if (regions.length > 5) {
        const bottom = regions.slice(-Math.min(5, regions.length));
        const bottomStr = bottom.map(r => `r.${r.rx}.${r.rz}=${r.chunks}`).join(', ');
        console.log(`    Sparsest: ${bottomStr}`);
      }
    }

    // Use only substantial regions for region coverage bounds
    for (const r of substantial) {
      const rMinX = r.rx * 512;
      const rMaxX = rMinX + 512;
      const rMinZ = r.rz * 512;
      const rMaxZ = rMinZ + 512;
      if (rMinX < regionMinX) regionMinX = rMinX;
      if (rMaxX > regionMaxX) regionMaxX = rMaxX;
      if (rMinZ < regionMinZ) regionMinZ = rMinZ;
      if (rMaxZ > regionMaxZ) regionMaxZ = rMaxZ;
    }
  }

  if (isFinite(regionMinX)) {
    console.log(`  Filtered region coverage: X[${regionMinX}..${regionMaxX}] Z[${regionMinZ}..${regionMaxZ}] (${regionMaxX - regionMinX}x${regionMaxZ - regionMinZ})`);
  }

  // Include ALL player positions — they drive the heatmap bounds
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

  // Compute player centroid for cap centering
  let playerSumX = 0, playerSumZ = 0, playerCount = 0;
  for (const p of allPlayers) {
    playerSumX += p.x;
    playerSumZ += p.z;
    playerCount++;
    if (p.x < minX) minX = Math.floor(p.x);
    if (p.x > maxX) maxX = Math.ceil(p.x);
    if (p.z < minZ) minZ = Math.floor(p.z);
    if (p.z > maxZ) maxZ = Math.ceil(p.z);
  }

  // Also include region coverage in bounds
  if (isFinite(regionMinX)) {
    if (regionMinX < minX) minX = regionMinX;
    if (regionMaxX > maxX) maxX = regionMaxX;
    if (regionMinZ < minZ) minZ = regionMinZ;
    if (regionMaxZ > maxZ) maxZ = regionMaxZ;
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

  // Final size cap — center on player centroid (where the data is),
  // falling back to region center or bounds center
  const computedWidth = maxX - minX;
  const computedHeight = maxZ - minZ;
  if (computedWidth > MAX_MAP_SIZE || computedHeight > MAX_MAP_SIZE) {
    const centerX = playerCount > 0
      ? playerSumX / playerCount
      : isFinite(regionMinX)
        ? (regionMinX + regionMaxX) / 2
        : (minX + maxX) / 2;
    const centerZ = playerCount > 0
      ? playerSumZ / playerCount
      : isFinite(regionMinZ)
        ? (regionMinZ + regionMaxZ) / 2
        : (minZ + maxZ) / 2;

    const capW = Math.min(computedWidth, MAX_MAP_SIZE);
    const capH = Math.min(computedHeight, MAX_MAP_SIZE);

    console.log(`  Bounds too large (${computedWidth}x${computedHeight}), capping to ${capW}x${capH} centered on player centroid (${Math.round(centerX)}, ${Math.round(centerZ)})`);

    minX = Math.floor((centerX - capW / 2) / 16) * 16;
    maxX = minX + Math.ceil(capW / 16) * 16;
    minZ = Math.floor((centerZ - capH / 2) / 16) * 16;
    maxZ = minZ + Math.ceil(capH / 16) * 16;
  }

  console.log(`Dynamic bounds: X[${minX}..${maxX}] Z[${minZ}..${maxZ}] (${maxX - minX}x${maxZ - minZ} blocks)\n`);

  // Update config and worldInfo
  config.bounds = { minX, maxX, minZ, maxZ };
  worldInfo.bounds = { minX, maxX, minZ, maxZ };

  return dimensionRegions;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
