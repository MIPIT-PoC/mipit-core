/**
 * Analytics Routes — Payment performance metrics and insights
 *
 * Endpoints:
 *   GET /analytics/latency       → P50/P95/P99 latency by pipeline step and rail
 *   GET /analytics/throughput    → Payments per minute/hour by rail
 *   GET /analytics/summary       → Overall system health summary
 *   GET /analytics/rails         → Per-rail breakdown with success rates
 *   GET /analytics/circuit-breakers → Circuit breaker states
 *   GET /analytics/rate-limits   → Rate limiter status per rail
 */

import type { FastifyInstance } from 'fastify';
import { registry } from '../../observability/metrics.js';
import { circuitBreakerRegistry } from '../../resilience/circuit-breaker.js';
import type { ReconciliationService } from '../../reconciliation/reconciliation-service.js';

import type { Pool } from 'pg';

interface AnalyticsDeps {
  reconciliationService: ReconciliationService;
  rateLimiter?: { getStatus: () => Array<{ rail: string; availableTokens: number; maxTokens: number; utilizationPct: number }> };
  db?: Pool;
}

export async function registerAnalyticsRoutes(app: FastifyInstance, deps: AnalyticsDeps) {
  /**
   * GET /analytics/latency
   * Returns latency percentiles (P50, P95, P99) per pipeline stage.
   */
  app.get('/analytics/latency', async (_req, reply) => {
    const metrics = await registry.getMetricsAsJSON();
    const latencyMetric = metrics.find((m) => m.name === 'mipit_payment_latency_ms');

    if (!latencyMetric || String(latencyMetric.type) !== 'histogram') {
      return reply.send({ stages: {}, message: 'No latency data yet' });
    }

    const stages: Record<string, { p50: number | null; p95: number | null; p99: number | null; count: number }> = {};

    // Parse histogram values to compute percentiles
    const values = latencyMetric.values as Array<{
      labels: Record<string, string>;
      value: number;
      metricName: string;
    }>;

    const stageData: Record<string, { sum: number; count: number; buckets: Array<{ le: number; count: number }> }> = {};

    for (const v of values) {
      const stage = v.labels.stage ?? 'unknown';
      if (!stageData[stage]) {
        stageData[stage] = { sum: 0, count: 0, buckets: [] };
      }

      if (v.metricName?.endsWith('_sum')) {
        stageData[stage].sum = v.value;
      } else if (v.metricName?.endsWith('_count')) {
        stageData[stage].count = v.value;
      } else if (v.labels.le) {
        stageData[stage].buckets.push({ le: parseFloat(v.labels.le), count: v.value });
      }
    }

    for (const [stage, data] of Object.entries(stageData)) {
      const sorted = data.buckets.sort((a, b) => a.le - b.le);
      stages[stage] = {
        p50: findPercentile(sorted, data.count, 0.5),
        p95: findPercentile(sorted, data.count, 0.95),
        p99: findPercentile(sorted, data.count, 0.99),
        count: data.count,
      };
    }

    return reply.send({ stages, generated_at: new Date().toISOString() });
  });

  /**
   * GET /analytics/summary
   * Overall system performance summary — sourced from database for durability.
   */
  app.get('/analytics/summary', async (_req, reply) => {
    if (!deps.db) {
      return reply.status(503).send({ error: 'Database not available for analytics' });
    }

    const statusCountsResult = await deps.db.query(
      `SELECT status, COUNT(*)::int AS count FROM payments GROUP BY status`,
    );
    const railCountsResult = await deps.db.query(
      `SELECT COALESCE(destination_rail, origin_rail) AS rail, status, COUNT(*)::int AS count
       FROM payments GROUP BY COALESCE(destination_rail, origin_rail), status`,
    );

    let totalPayments = 0;
    let completedPayments = 0;
    let failedPayments = 0;
    let rejectedPayments = 0;

    for (const row of statusCountsResult.rows as Array<{ status: string; count: number }>) {
      totalPayments += row.count;
      if (row.status === 'COMPLETED') completedPayments = row.count;
      else if (row.status === 'FAILED') failedPayments = row.count;
      else if (row.status === 'REJECTED') rejectedPayments = row.count;
    }

    const byRail: Record<string, { sent: number; completed: number; failed: number; success_rate: number }> = {};
    for (const row of railCountsResult.rows as Array<{ rail: string; status: string; count: number }>) {
      const r = row.rail ?? 'unknown';
      if (!byRail[r]) byRail[r] = { sent: 0, completed: 0, failed: 0, success_rate: 0 };
      byRail[r].sent += row.count;
      if (row.status === 'COMPLETED') byRail[r].completed += row.count;
      else if (row.status === 'FAILED' || row.status === 'REJECTED') byRail[r].failed += row.count;
    }
    for (const r of Object.values(byRail)) {
      r.success_rate = r.sent > 0 ? Math.round((r.completed / r.sent) * 100) : 0;
    }

    return reply.send({
      generated_at: new Date().toISOString(),
      payments: {
        total: totalPayments,
        completed: completedPayments,
        failed: failedPayments,
        rejected: rejectedPayments,
        success_rate: totalPayments > 0 ? Math.round((completedPayments / totalPayments) * 100) : 0,
      },
      by_rail: byRail,
      circuit_breakers: circuitBreakerRegistry.getAllStates(),
      rate_limits: deps.rateLimiter?.getStatus() ?? [],
    });
  });

  /**
   * GET /analytics/circuit-breakers
   * Current circuit breaker states for all rails.
   */
  app.get('/analytics/circuit-breakers', async (_req, reply) => {
    return reply.send({
      breakers: circuitBreakerRegistry.getAllStates(),
      generated_at: new Date().toISOString(),
    });
  });

  /**
   * GET /analytics/rate-limits
   * Current rate limiter status per rail.
   */
  app.get('/analytics/rate-limits', async (_req, reply) => {
    return reply.send({
      limits: deps.rateLimiter?.getStatus() ?? [],
      generated_at: new Date().toISOString(),
    });
  });

  /**
   * GET /analytics/reconciliation
   * Run on-demand reconciliation and return the report.
   */
  app.get<{ Querystring: { hours?: string; stuckMinutes?: string } }>(
    '/analytics/reconciliation',
    async (req, reply) => {
      const windowHours = parseInt(req.query.hours ?? '24', 10);
      const stuckThresholdMinutes = parseInt(req.query.stuckMinutes ?? '15', 10);

      const report = await deps.reconciliationService.runReconciliation({
        windowHours,
        stuckThresholdMinutes,
      });

      return reply.send(report);
    },
  );
}

/** Estimate a percentile from histogram buckets */
function findPercentile(
  buckets: Array<{ le: number; count: number }>,
  totalCount: number,
  percentile: number,
): number | null {
  if (totalCount === 0 || buckets.length === 0) return null;
  const target = totalCount * percentile;
  for (const bucket of buckets) {
    if (bucket.count >= target) {
      return bucket.le;
    }
  }
  return buckets[buckets.length - 1]?.le ?? null;
}
