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
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
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
