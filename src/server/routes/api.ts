import type { FastifyInstance } from 'fastify';
import { playerStore } from '../services/player-store.js';
import { renderHeatmap } from '../services/heatmap-renderer.js';
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

  // Re-render heatmap with filters
  app.post<{
    Body: HeatmapRenderRequest;
  }>('/api/heatmap/render', async (req) => {
    const { dimension, afterDate, beforeDate } = req.body;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const url = await renderHeatmap(dimension, { afterDate, beforeDate, id });
    return { url };
  });
}
