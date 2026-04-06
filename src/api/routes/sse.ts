/**
 * Server-Sent Events (SSE) for real-time payment tracking
 *
 * Endpoints:
 *   GET /events/payments          → Stream all payment status updates
 *   GET /events/payments/:id      → Stream updates for a specific payment
 *
 * The SSE stream pushes events whenever a payment transitions status.
 * The UI can subscribe to watch payments flow through the pipeline in real-time.
 *
 * Event format:
 *   event: payment_update
 *   data: { payment_id, status, timestamp, ... }
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../observability/logger.js';

type SseClient = {
  id: string;
  reply: FastifyReply;
  paymentFilter?: string; // If set, only send events for this payment
};

/** Global list of connected SSE clients */
const clients: SseClient[] = [];
let clientIdCounter = 0;

/**
 * Broadcast a payment event to all connected SSE clients.
 * Called from the pipeline, consumer, compensation service, etc.
 */
export function broadcastPaymentEvent(event: {
  payment_id: string;
  status: string;
  previous_status?: string;
  destination_rail?: string;
  origin_rail?: string;
  fx?: Record<string, unknown>;
  latency_ms?: number;
  error?: string;
  timestamp: string;
}): void {
  const data = JSON.stringify(event);

  for (let i = clients.length - 1; i >= 0; i--) {
    const client = clients[i];

    // Filter if client is watching a specific payment
    if (client.paymentFilter && client.paymentFilter !== event.payment_id) {
      continue;
    }

    try {
      client.reply.raw.write(`event: payment_update\ndata: ${data}\n\n`);
    } catch {
      // Client disconnected — remove
      clients.splice(i, 1);
    }
  }
}

export async function registerSseRoutes(app: FastifyInstance) {
  /**
   * GET /events/payments — Stream all payment updates
   */
  app.get('/events/payments', async (req: FastifyRequest, reply: FastifyReply) => {
    const clientId = `sse-${++clientIdCounter}`;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });

    // Send initial connection event
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ clientId, message: 'Connected to MIPIT payment stream' })}\n\n`);

    const client: SseClient = { id: clientId, reply };
    clients.push(client);

    logger.info({ clientId, totalClients: clients.length }, 'SSE client connected');

    // Keep-alive ping every 30s
    const keepAlive = setInterval(() => {
      try {
        reply.raw.write(`: keepalive\n\n`);
      } catch {
        clearInterval(keepAlive);
      }
    }, 30_000);

    // Cleanup on disconnect
    req.raw.on('close', () => {
      clearInterval(keepAlive);
      const idx = clients.findIndex((c) => c.id === clientId);
      if (idx >= 0) clients.splice(idx, 1);
      logger.info({ clientId, totalClients: clients.length }, 'SSE client disconnected');
    });

    // Don't call reply.send() — we're streaming
    await reply.hijack();
  });

  /**
   * GET /events/payments/:paymentId — Stream updates for a specific payment
   */
  app.get<{ Params: { paymentId: string } }>(
    '/events/payments/:paymentId',
    async (req, reply) => {
      const { paymentId } = req.params;
      const clientId = `sse-${++clientIdCounter}-${paymentId}`;

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });

      reply.raw.write(
        `event: connected\ndata: ${JSON.stringify({ clientId, paymentId, message: `Watching payment ${paymentId}` })}\n\n`,
      );

      const client: SseClient = { id: clientId, reply, paymentFilter: paymentId };
      clients.push(client);

      logger.info({ clientId, paymentId }, 'SSE client connected for specific payment');

      const keepAlive = setInterval(() => {
        try {
          reply.raw.write(`: keepalive\n\n`);
        } catch {
          clearInterval(keepAlive);
        }
      }, 30_000);

      req.raw.on('close', () => {
        clearInterval(keepAlive);
        const idx = clients.findIndex((c) => c.id === clientId);
        if (idx >= 0) clients.splice(idx, 1);
        logger.info({ clientId }, 'SSE client disconnected');
      });

      await reply.hijack();
    },
  );

  /**
   * GET /events/clients — Number of connected SSE clients (for monitoring)
   */
  app.get('/events/clients', async (_req, reply) => {
    return reply.send({
      connected_clients: clients.length,
      clients: clients.map((c) => ({ id: c.id, filter: c.paymentFilter ?? 'all' })),
    });
  });
}
