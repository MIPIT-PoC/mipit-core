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
 * W5.9 — verify a JWT passed as ?token=<jwt> query string.
 * EventSource cannot send Authorization headers, so we accept the token in the
 * query string and validate it with the Fastify JWT plugin's verify helper.
 * Returns true if the token is valid, false otherwise.
 */
function verifySseToken(app: FastifyInstance, token: string | undefined): boolean {
  if (!token) return false;
  try {
    // Fastify JWT plugin attaches .jwt.verify to the app instance.
    (app as unknown as { jwt: { verify: (t: string) => unknown } }).jwt.verify(token);
    return true;
  } catch {
    return false;
  }
}

/**
 * Broadcast a payment event to all connected SSE clients.
 * Called from the pipeline, consumer, compensation service, etc.
 */
export function broadcastPaymentEvent(event: {
  payment_id: string;
  status: string;
  previous_status?: string;
  destination_rail?: string | null;
  origin_rail?: string;
  fx?: Record<string, unknown>;
  latency_ms?: number;
  error?: string;
  /** P01: ISO 20022 TxSts code (ACSC/ACSP/RJCT/PART/PDNG). */
  tx_sts?: string;
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
    // W5.9 — SSE auth via ?token=<jwt>. Refuse before opening the stream so
    // PII (debtor/creditor names, amounts) cannot leak to an unauthenticated
    // client.
    const token = (req.query as { token?: string } | undefined)?.token;
    if (!verifySseToken(app, token)) {
      return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'SSE stream requires a valid ?token=<jwt>' });
    }

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
      // W5.9 — SSE auth via ?token=<jwt>
      const token = (req.query as { token?: string } | undefined)?.token;
      if (!verifySseToken(app, token)) {
        return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'SSE stream requires a valid ?token=<jwt>' });
      }

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
  app.get('/events/clients', async (req, reply) => {
    // W5.9 — even monitoring endpoint needs a token to avoid leaking client filters
    const token = (req.query as { token?: string } | undefined)?.token;
    if (!verifySseToken(app, token)) {
      return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'SSE monitoring requires a valid ?token=<jwt>' });
    }
    return reply.send({
      connected_clients: clients.length,
      clients: clients.map((c) => ({ id: c.id, filter: c.paymentFilter ?? 'all' })),
    });
  });
}
