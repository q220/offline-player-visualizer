import type { FastifyInstance } from 'fastify';
import { playerStore } from '../services/player-store.js';
import { renderHeatmap } from '../services/heatmap-renderer.js';
import { renderTile } from '../services/map-renderer.js';
import { config } from '../config.js';
import type { WorldInfo, HeatmapRenderRequest } from '../../shared/protocol.js';

export async function registerApiRoutes(
  app: FastifyInstance,
  worldInfo: WorldInfo,
): Promise<void> {
  // World info
  app.get('/api/world-info', async () => {
    return {
      ...worldInfo,
      playerCount: playerStore.count,
      dimensions:
        playerStore.getDimensions().length > 0
          ? playerStore.getDimensions()
          : worldInfo.dimensions,
    };
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
      after: after ? parseInt(after) : undefined,
      before: before ? parseInt(before) : undefined,
      limit: limit ? parseInt(limit) : 10000,
      offset: offset ? parseInt(offset) : 0,
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
    const results = playerStore.search(q, limit ? parseInt(limit) : 20);
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
    const tx = parseInt(txStr);
    const ty = parseInt(tyStr.replace('.png', ''));

    if (isNaN(tx) || isNaN(ty)) {
      reply.code(400);
      return { error: 'Invalid tile coordinates' };
    }

    // Resolve full dimension name
    const fullDim = dimension.includes(':') ? dimension : `minecraft:${dimension}`;

    try {
      const pngBuffer = await renderTile(config.worldPath, fullDim, tx, ty);
      if (!pngBuffer) {
        reply.code(404);
        return reply.send();
      }

      reply.header('Content-Type', 'image/png');
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.send(pngBuffer);
    } catch (e: any) {
      console.error(`Tile render error (${dimension} ${tx},${ty}):`, e.message);
      reply.code(500);
      return { error: 'Tile render failed' };
    }
  });

  // Re-render heatmap with filters
  app.post<{
    Body: HeatmapRenderRequest;
  }>('/api/heatmap/render', async (req) => {
    const { dimension, afterDate, beforeDate, viewport } = req.body;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await renderHeatmap(dimension, { afterDate, beforeDate, viewport, id });
    return {
      url: result.url,
      contoursUrl: result.contoursUrl,
      maxPerChunk: result.maxPerChunk,
      totalPlayers: result.totalPlayers,
    };
  });
}
