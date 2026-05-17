/**
 * P08: Deep health probe. Returns 503 if DB or RabbitMQ are not reachable
 * so k8s/docker readiness probes actually fail when the stack is degraded.
 *
 * Two endpoints:
 *   - `/health`        — deep probe (DB + MQ); 503 on degraded
 *   - `/health/live`   — liveness only (process up); always 200
 */
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Channel } from 'amqplib';
import { logger } from '../../observability/logger.js';

const startTime = Date.now();

export interface HealthDeps {
  db?: Pool;
  channel?: Channel;
}

let healthDeps: HealthDeps = {};

/** Allow `index.ts` to inject pool + channel once they're built. */
export function setHealthDeps(deps: HealthDeps): void {
  healthDeps = deps;
}

async function checkDb(pool?: Pool): Promise<'ok' | string> {
  if (!pool) return 'no_pool';
  try {
    await pool.query('SELECT 1');
    return 'ok';
  } catch (err) {
    return `error: ${String(err)}`;
  }
}

async function checkRabbitMQ(ch?: Channel): Promise<'ok' | string> {
  if (!ch) return 'no_channel';
  try {
    await ch.checkExchange('mipit.payments');
    return 'ok';
  } catch (err) {
    return `error: ${String(err)}`;
  }
}

export async function healthRoutes(app: FastifyInstance) {
  // Liveness — always green if process is up
  app.get('/health/live', async (_req, reply) => {
    return reply.send({
      status: 'ok',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version: '0.1.0',
    });
  });

  // Deep readiness probe
  app.get('/health', async (_req, reply) => {
    const [db, rabbitmq] = await Promise.all([
      checkDb(healthDeps.db),
      checkRabbitMQ(healthDeps.channel),
    ]);
    const ok = db === 'ok' && rabbitmq === 'ok';
    const body = {
      status: ok ? 'ok' : 'degraded',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version: '0.1.0',
      checks: { db, rabbitmq },
    };
    if (!ok) logger.warn(body, 'Health degraded');
    return reply.code(ok ? 200 : 503).send(body);
  });
}
