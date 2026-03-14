import { performance } from 'node:perf_hooks';
import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const paymentCounter = new client.Counter({
  name: 'mipit_payments_total',
  help: 'Total payments processed',
  labelNames: ['status', 'origin_rail', 'destination_rail'],
  registers: [registry],
});

export const paymentLatency = new client.Histogram({
  name: 'mipit_payment_latency_ms',
  help: 'Payment processing latency in milliseconds by stage',
  labelNames: ['stage'],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500],
  registers: [registry],
});

export const translationErrors = new client.Counter({
  name: 'mipit_translation_errors_total',
  help: 'Translation errors by rail',
  labelNames: ['rail', 'error_type'],
  registers: [registry],
});

export const routingDecisions = new client.Counter({
  name: 'mipit_routing_decisions_total',
  help: 'Routing decisions by rule applied',
  labelNames: ['rule', 'destination_rail'],
  registers: [registry],
});

export const idempotencyHits = new client.Counter({
  name: 'mipit_idempotency_hits_total',
  help: 'Idempotency cache hits (duplicates blocked)',
  registers: [registry],
});

export function recordPayment(status: string, originRail: string, destinationRail: string) {
  paymentCounter.inc({ status, origin_rail: originRail, destination_rail: destinationRail });
}

export function recordLatency(stage: string, durationMs: number) {
  paymentLatency.observe({ stage }, durationMs);
}

export function recordTranslationError(rail: string, errorType: string) {
  translationErrors.inc({ rail, error_type: errorType });
}

export function recordRoutingDecision(rule: string, destinationRail: string) {
  routingDecisions.inc({ rule, destination_rail: destinationRail });
}

export function recordIdempotencyHit() {
  idempotencyHits.inc();
}

export function startLatencyTimer(stage: string): () => void {
  const start = performance.now();
  return () => {
    paymentLatency.observe({ stage }, performance.now() - start);
  };
}
