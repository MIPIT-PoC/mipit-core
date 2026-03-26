jest.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: jest.fn(),
  },
}));

import { tracingMiddleware } from '../../../src/api/middleware/tracing';
import { trace } from '@opentelemetry/api';

describe('tracingMiddleware', () => {
  const mockReply = () => ({
    header: jest.fn(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should use X-Trace-ID header when provided', async () => {
    const request = {
      headers: { 'x-trace-id': 'my-custom-trace-id' },
    } as unknown as Parameters<typeof tracingMiddleware>[0];
    const reply = mockReply();

    await tracingMiddleware(request, reply as unknown as Parameters<typeof tracingMiddleware>[1]);

    expect((request as unknown as Record<string, unknown>).traceId).toBe('my-custom-trace-id');
    expect(reply.header).toHaveBeenCalledWith('X-Trace-ID', 'my-custom-trace-id');
  });

  it('should generate ULID when X-Trace-ID header is absent', async () => {
    const request = {
      headers: {},
    } as unknown as Parameters<typeof tracingMiddleware>[0];
    const reply = mockReply();

    await tracingMiddleware(request, reply as unknown as Parameters<typeof tracingMiddleware>[1]);

    const traceId = (request as unknown as Record<string, unknown>).traceId as string;
    expect(traceId).toBeDefined();
    expect(traceId.length).toBeGreaterThan(0);
    expect(reply.header).toHaveBeenCalledWith('X-Trace-ID', traceId);
  });

  it('should set response header X-Trace-ID', async () => {
    const request = {
      headers: { 'x-trace-id': 'trace-abc' },
    } as unknown as Parameters<typeof tracingMiddleware>[0];
    const reply = mockReply();

    await tracingMiddleware(request, reply as unknown as Parameters<typeof tracingMiddleware>[1]);

    expect(reply.header).toHaveBeenCalledWith('X-Trace-ID', 'trace-abc');
  });

  it('should propagate traceId to active OTel span when available', async () => {
    const mockSetAttribute = jest.fn();
    (trace.getActiveSpan as jest.Mock).mockReturnValue({
      setAttribute: mockSetAttribute,
    });

    const request = {
      headers: { 'x-trace-id': 'trace-otel' },
    } as unknown as Parameters<typeof tracingMiddleware>[0];
    const reply = mockReply();

    await tracingMiddleware(request, reply as unknown as Parameters<typeof tracingMiddleware>[1]);

    expect(mockSetAttribute).toHaveBeenCalledWith('mipit.trace_id', 'trace-otel');
  });

  it('should not throw when no active OTel span exists', async () => {
    (trace.getActiveSpan as jest.Mock).mockReturnValue(undefined);

    const request = {
      headers: { 'x-trace-id': 'trace-no-span' },
    } as unknown as Parameters<typeof tracingMiddleware>[0];
    const reply = mockReply();

    await expect(
      tracingMiddleware(request, reply as unknown as Parameters<typeof tracingMiddleware>[1]),
    ).resolves.not.toThrow();
  });
});
