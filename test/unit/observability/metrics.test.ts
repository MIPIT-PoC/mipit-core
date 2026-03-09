import {
  registry,
  paymentCounter,
  paymentLatency,
  idempotencyHits,
  recordPayment,
  recordLatency,
  recordIdempotencyHit,
  startLatencyTimer,
} from '../../../src/observability/metrics';

describe('metrics', () => {
  beforeEach(() => {
    registry.resetMetrics();
  });

  it('has all 5 custom metrics registered', async () => {
    const json = await registry.getMetricsAsJSON();
    const names = json.map((m) => m.name);
    expect(names).toContain('mipit_payments_total');
    expect(names).toContain('mipit_payment_latency_ms');
    expect(names).toContain('mipit_translation_errors_total');
    expect(names).toContain('mipit_routing_decisions_total');
    expect(names).toContain('mipit_idempotency_hits_total');
  });

  it('paymentCounter is Counter with correct labels', () => {
    const labels = (paymentCounter as unknown as { labelNames: string[] }).labelNames;
    expect(labels).toContain('status');
    expect(labels).toContain('origin_rail');
    expect(labels).toContain('destination_rail');
  });

  it('paymentLatency has the specified buckets', async () => {
    recordLatency('TEST', 1);
    const text = await registry.metrics();
    const expectedBuckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500];
    for (const b of expectedBuckets) {
      expect(text).toContain(`le="${b}"`);
    }
  });

  it('recordPayment increments the counter', async () => {
    recordPayment('COMPLETED', 'PIX', 'SPEI');
    const data = await paymentCounter.get();
    const val = data.values.find(
      (v) =>
        v.labels.status === 'COMPLETED' &&
        v.labels.origin_rail === 'PIX' &&
        v.labels.destination_rail === 'SPEI',
    );
    expect(val).toBeDefined();
    expect(val!.value).toBe(1);
  });

  it('recordLatency observes duration in histogram', async () => {
    recordLatency('TRANSLATE', 42);
    const data = await paymentLatency.get();
    const sumVal = data.values.find(
      (v) => v.labels.stage === 'TRANSLATE' && v.metricName?.endsWith('_sum'),
    );
    expect(sumVal).toBeDefined();
    expect(sumVal!.value).toBe(42);
  });

  it('startLatencyTimer measures elapsed duration', async () => {
    const stop = startLatencyTimer('ROUTE');
    await new Promise((r) => setTimeout(r, 15));
    stop();
    const data = await paymentLatency.get();
    const sumVal = data.values.find(
      (v) => v.labels.stage === 'ROUTE' && v.metricName?.endsWith('_sum'),
    );
    expect(sumVal).toBeDefined();
    expect(sumVal!.value).toBeGreaterThan(0);
  });

  it('recordIdempotencyHit increments without labels', async () => {
    recordIdempotencyHit();
    recordIdempotencyHit();
    const data = await idempotencyHits.get();
    expect(data.values[0].value).toBe(2);
  });

  it('default metrics are registered', async () => {
    const json = await registry.getMetricsAsJSON();
    const names = json.map((m) => m.name);
    const hasProcessMetric =
      names.includes('process_cpu_seconds_total') ||
      names.includes('nodejs_eventloop_lag_seconds');
    expect(hasProcessMetric).toBe(true);
  });
});
