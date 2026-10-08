import type { FastifyInstance, FastifyReply } from 'fastify';
import { playerStore } from '../services/player-store.js';
import { renderHeatmap, getStoredHeatmap } from '../services/heatmap-renderer.js';
import { renderTile } from '../services/map-renderer.js';
import { config } from '../config.js';
import type { WorldInfo, HeatmapRenderRequest, DropoutHeatmapRequest, HeatmapRenderResponse } from '../../shared/protocol.js';
import { DEFAULT_HUB_DATE } from '../../shared/protocol.js';

const boundsSchema = {
  type: 'object',
  required: ['minX', 'maxX', 'minZ', 'maxZ'],
  properties: {
    minX: { type: 'number' },
    maxX: { type: 'number' },
    minZ: { type: 'number' },
    maxZ: { type: 'number' },
  },
} as const;

const heatmapBodySchema = {
  type: 'object',
  required: ['dimension'],
  properties: {
    dimension: { type: 'string' },
    afterDate: { type: 'number' },
    beforeDate: { type: 'number' },
    cutoffDate: { type: 'number' },
    viewport: boundsSchema,
    renderBounds: boundsSchema,
  },
} as const;

/** Parse an optional numeric query value; undefined when absent or not a number */
function optionalInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

export async function registerApiRoutes(
  app: FastifyInstance,
  worldInfo: WorldInfo,
): Promise<void> {
  const knownDimensions = new Set(worldInfo.dimensions);

  /** Renders a heatmap, answering 400 when the request is unusable */
  async function heatmapOrError(
    reply: FastifyReply,
    dimension: string,
    render: () => Promise<HeatmapRenderResponse>,
  ): Promise<HeatmapRenderResponse | { error: string }> {
    if (!knownDimensions.has(dimension)) {
      reply.code(400);
      return { error: 'Unknown dimension' };
    }
    try {
      return await render();
    } catch (e) {
      if (e instanceof RangeError) {
        reply.code(400);
        return { error: e.message };
      }
      throw e;
    }
  }

  // World info
  app.get('/api/world-info', async () => {
    return { ...worldInfo, playerCount: playerStore.count };
  });

  // List players (paginated)
  app.get<{
    Querystring: {
      dimension?: string;
      after?: string;
      before?: string;
      limit?: string;
      offset?: string;
    };
  }>('/api/players', async (req) => {
    const { dimension, after, before, limit, offset } = req.query;
    return playerStore.getAll({
      dimension,
      after: optionalInt(after),
      before: optionalInt(before),
      limit: optionalInt(limit),
      offset: optionalInt(offset),
    });
  });

  // Search players by name
  app.get<{
    Querystring: { q: string; limit?: string };
  }>('/api/players/search', async (req) => {
    const { q, limit } = req.query;
    if (!q || q.length < 1) {
      return { results: [] };
    }
    const results = playerStore.search(q, Math.min(optionalInt(limit) ?? 20, 100));
    return { results };
  });

  // Get single player by UUID
  app.get<{
    Params: { uuid: string };
  }>('/api/players/:uuid', async (req, reply) => {
    const player = playerStore.getByUuid(req.params.uuid);
    if (!player) {
      reply.code(404);
      return { error: 'Player not found' };
    }
    return player;
  });

  // On-demand tile rendering
  app.get<{
    Params: { dimension: string; tx: string; ty: string };
  }>('/api/tiles/:dimension/:tx/:ty', async (req, reply) => {
    const { dimension, tx: txStr, ty: tyStr } = req.params;
    if (!/^-?\d+$/.test(txStr) || !/^-?\d+(\.png)?$/.test(tyStr)) {
      reply.code(400);
      return { error: 'Invalid tile coordinates' };
    }
    const tx = parseInt(txStr, 10);
    const ty = parseInt(tyStr, 10);

    // Resolve full dimension name
    const fullDim = dimension.includes(':') ? dimension : `minecraft:${dimension}`;
    if (!knownDimensions.has(fullDim)) {
      reply.code(404);
      return { error: 'Unknown dimension' };
    }

    try {
      const pngBuffer = await renderTile(config.worldPath, fullDim, tx, ty);
      if (!pngBuffer) {
        reply.code(404);
        return reply.send();
      }

      reply.header('Content-Type', 'image/png');
      // Tiles are re-rendered when their region is saved, so keep browser caching short
      reply.header('Cache-Control', 'public, max-age=3600');
      return reply.send(pngBuffer);
    } catch (e: any) {
      console.error(`Tile render error (${dimension} ${tx},${ty}):`, e.message);
      reply.code(500);
      return { error: 'Tile render failed' };
    }
  });

  // Server-side clustered players for viewport
  app.get<{
    Querystring: {
      dimension: string;
      zoom: string;
      minX: string;
      maxX: string;
      minZ: string;
      maxZ: string;
      after?: string;
      before?: string;
    };
  }>('/api/players/clusters', async (req, reply) => {
    const { dimension, zoom, minX, maxX, minZ, maxZ, after, before } = req.query;
    const nums = [zoom, minX, maxX, minZ, maxZ].map((v) => parseFloat(v));
    if (nums.some((n) => !Number.isFinite(n))) {
      reply.code(400);
      return { error: 'zoom, minX, maxX, minZ and maxZ must be numbers' };
    }
    return playerStore.getClusters({
      dimension,
      zoom: nums[0],
      minX: nums[1],
      maxX: nums[2],
      minZ: nums[3],
      maxZ: nums[4],
      after: optionalInt(after),
      before: optionalInt(before),
    });
  });

  // Re-render heatmap with filters
  app.post<{
    Body: HeatmapRenderRequest;
  }>('/api/heatmap/render', { schema: { body: heatmapBodySchema } }, async (req, reply) => {
    const { dimension, afterDate, beforeDate, viewport, renderBounds } = req.body;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const parts = [dimension];
    if (afterDate) parts.push(`after=${new Date(afterDate).toISOString().slice(0, 10)}`);
    if (beforeDate) parts.push(`before=${new Date(beforeDate).toISOString().slice(0, 10)}`);
    if (viewport) parts.push(`viewport=[${viewport.minX}..${viewport.maxX}, ${viewport.minZ}..${viewport.maxZ}]`);
    if (renderBounds) parts.push(`renderBounds=[${renderBounds.minX}..${renderBounds.maxX}, ${renderBounds.minZ}..${renderBounds.maxZ}]`);
    console.log(`\nHeatmap render request: ${parts.join(', ')}`);
    return heatmapOrError(reply, dimension, () =>
      renderHeatmap(dimension, { afterDate, beforeDate, viewport, renderBounds, id }));
  });

  // Rendered heatmap images and contour lines
  app.get<{
    Params: { id: string };
  }>('/api/heatmaps/:id/heatmap.png', async (req, reply) => {
    const stored = getStoredHeatmap(req.params.id);
    if (!stored) {
      reply.code(404);
      return { error: 'Heatmap not found (expired)' };
    }
    reply.header('Content-Type', 'image/png');
    return reply.send(stored.png);
  });

  app.get<{
    Params: { id: string };
  }>('/api/heatmaps/:id/contours.json', async (req, reply) => {
    const stored = getStoredHeatmap(req.params.id);
    if (!stored) {
      reply.code(404);
      return { error: 'Heatmap not found (expired)' };
    }
    return stored.contours;
  });

  // Hub intro metrics
  app.get<{
    Querystring: { since?: string };
  }>('/api/hub-metrics', async (req) => {
    return playerStore.getHubMetrics(optionalInt(req.query.since) ?? DEFAULT_HUB_DATE);
  });

  // Dropout heatmap rendering
  app.post<{
    Body: DropoutHeatmapRequest;
  }>('/api/heatmap/dropout', { schema: { body: heatmapBodySchema } }, async (req, reply) => {
    const { dimension, cutoffDate, viewport, renderBounds } = req.body;
    const cutoff = cutoffDate ?? DEFAULT_HUB_DATE;
    const id = `dropout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    console.log(`\nDropout heatmap request: ${dimension}, cutoff=${new Date(cutoff).toISOString().slice(0, 10)}`);

    return heatmapOrError(reply, dimension, () =>
      renderHeatmap(dimension, {
        id,
        viewport,
        renderBounds,
        colorRamp: 'dropout',
        players: playerStore.getDropoutPlayers(dimension, cutoff),
      }));
  });
}
