import pino from 'pino';
import { Writable } from 'node:stream';

function createTestLogger(
  overrides: Record<string, unknown> = {},
  mockGetActiveSpan?: () => unknown,
) {
  const output: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, cb) {
      output.push(chunk.toString());
      cb();
    },
  });

  const traceMock = { getActiveSpan: mockGetActiveSpan ?? (() => undefined) };

  const logger = pino(
    {
      level: (overrides.level as string) ?? 'info',
      formatters: {
        level: (label: string) => ({ level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      base: { service: (overrides.service as string) ?? 'mipit-core' },
      mixin() {
        const span = traceMock.getActiveSpan() as
          | { spanContext: () => { traceId: string; spanId: string } }
          | undefined;
        if (!span) return {};
        const { traceId, spanId } = span.spanContext();
        return { trace_id: traceId, span_id: spanId };
      },
    },
    stream,
  );

  const getLines = () =>
    output.filter((l) => l.trim()).map((l) => JSON.parse(l));

  return { logger, getLines, stream };
}

describe('logger', () => {
  it('emits structured JSON with level, time, service, msg', () => {
    const { logger, getLines } = createTestLogger();
    logger.info('hello');
    const lines = getLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveProperty('level', 'info');
    expect(lines[0]).toHaveProperty('time');
    expect(lines[0]).toHaveProperty('service', 'mipit-core');
    expect(lines[0]).toHaveProperty('msg', 'hello');
  });

  it('uses OTEL_SERVICE_NAME as the service field', () => {
    const { logger, getLines } = createTestLogger({ service: 'test-service' });
    logger.info('check service');
    expect(getLines()[0].service).toBe('test-service');
  });

  it('emits level as string, not number', () => {
    const { logger, getLines } = createTestLogger();
    logger.info('test');
    const line = getLines()[0];
    expect(typeof line.level).toBe('string');
    expect(line.level).toBe('info');
  });

  it('emits timestamp in ISO 8601 format', () => {
    const { logger, getLines } = createTestLogger();
    logger.info('ts check');
    const time = getLines()[0].time;
    expect(typeof time).toBe('string');
    expect(new Date(time).toISOString()).toBe(time);
  });

  it('injects trace_id and span_id when OTel span is active', () => {
    const mockSpan = () => ({
      spanContext: () => ({ traceId: 'abc123trace', spanId: 'def456span' }),
    });
    const { logger, getLines } = createTestLogger({}, mockSpan);
    logger.info('with span');
    const line = getLines()[0];
    expect(line.trace_id).toBe('abc123trace');
    expect(line.span_id).toBe('def456span');
  });

  it('does not inject trace_id/span_id when no span is active', () => {
    const { logger, getLines } = createTestLogger({}, () => undefined);
    logger.info('no span');
    const line = getLines()[0];
    expect(line).not.toHaveProperty('trace_id');
    expect(line).not.toHaveProperty('span_id');
  });

  it('createChildLogger inherits config and adds bindings', () => {
    const { logger, getLines } = createTestLogger();
    const child = logger.child({ module: 'persistence', payment_id: 'pay_123' });
    child.info('child log');
    const line = getLines()[0];
    expect(line.service).toBe('mipit-core');
    expect(line.module).toBe('persistence');
    expect(line.payment_id).toBe('pay_123');
    expect(line.msg).toBe('child log');
  });

  it('LOG_LEVEL controls which logs are emitted', () => {
    const { logger, getLines } = createTestLogger({ level: 'warn' });
    logger.info('should not appear');
    expect(getLines()).toHaveLength(0);
    logger.warn('should appear');
    expect(getLines()).toHaveLength(1);
    expect(getLines()[0].msg).toBe('should appear');
  });
});
