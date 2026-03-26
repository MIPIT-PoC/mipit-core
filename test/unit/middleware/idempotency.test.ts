import { idempotencyMiddleware } from '../../../src/api/middleware/idempotency';

describe('idempotencyMiddleware', () => {
  const mockRepo = () => ({
    findByKey: jest.fn(),
    insert: jest.fn(),
    updateResponse: jest.fn(),
  });

  const mockReply = () => {
    const reply: Record<string, unknown> = {};
    reply.status = jest.fn().mockReturnValue(reply);
    reply.send = jest.fn().mockReturnValue(reply);
    return reply as unknown as { status: jest.Mock; send: jest.Mock };
  };

  it('should pass through when no Idempotency-Key header is present', async () => {
    const repo = mockRepo();
    const middleware = idempotencyMiddleware(repo as any);

    const request = {
      headers: {},
      body: { amount: 100 },
    } as unknown as Parameters<ReturnType<typeof idempotencyMiddleware>>[0];
    const reply = mockReply();

    await middleware(request, reply as any);

    expect(repo.findByKey).not.toHaveBeenCalled();
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('should return cached response when key exists with matching hash', async () => {
    const repo = mockRepo();
    const body = { amount: 100 };
    const crypto = require('node:crypto');
    const expectedHash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');

    repo.findByKey.mockResolvedValue({
      idempotency_key: 'key-1',
      request_hash: expectedHash,
      response_status: 201,
      response_body: { payment_id: 'pmt-123' },
    });

    const middleware = idempotencyMiddleware(repo as any);
    const request = {
      headers: { 'idempotency-key': 'key-1' },
      body,
    } as unknown as Parameters<ReturnType<typeof idempotencyMiddleware>>[0];
    const reply = mockReply();

    await middleware(request, reply as any);

    expect(reply.status).toHaveBeenCalledWith(201);
    expect(reply.send).toHaveBeenCalledWith({ payment_id: 'pmt-123' });
  });

  it('should return 409 when key exists with different hash', async () => {
    const repo = mockRepo();
    repo.findByKey.mockResolvedValue({
      idempotency_key: 'key-1',
      request_hash: 'different-hash',
      response_status: 201,
      response_body: {},
    });

    const middleware = idempotencyMiddleware(repo as any);
    const request = {
      headers: { 'idempotency-key': 'key-1' },
      body: { amount: 200 },
    } as unknown as Parameters<ReturnType<typeof idempotencyMiddleware>>[0];
    const reply = mockReply();

    await middleware(request, reply as any);

    expect(reply.status).toHaveBeenCalledWith(409);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }),
    );
  });

  it('should set idempotencyKey and requestHash on request for new keys', async () => {
    const repo = mockRepo();
    repo.findByKey.mockResolvedValue(null);

    const middleware = idempotencyMiddleware(repo as any);
    const request = {
      headers: { 'idempotency-key': 'new-key' },
      body: { amount: 300 },
    } as unknown as Parameters<ReturnType<typeof idempotencyMiddleware>>[0];
    const reply = mockReply();

    await middleware(request, reply as any);

    expect((request as any).idempotencyKey).toBe('new-key');
    expect((request as any).requestHash).toBeDefined();
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('should default to 202 when response_status is null', async () => {
    const repo = mockRepo();
    const body = { amount: 100 };
    const crypto = require('node:crypto');
    const expectedHash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');

    repo.findByKey.mockResolvedValue({
      idempotency_key: 'key-1',
      request_hash: expectedHash,
      response_status: null,
      response_body: { payment_id: 'pmt-456' },
    });

    const middleware = idempotencyMiddleware(repo as any);
    const request = {
      headers: { 'idempotency-key': 'key-1' },
      body,
    } as unknown as Parameters<ReturnType<typeof idempotencyMiddleware>>[0];
    const reply = mockReply();

    await middleware(request, reply as any);

    expect(reply.status).toHaveBeenCalledWith(202);
  });
});
