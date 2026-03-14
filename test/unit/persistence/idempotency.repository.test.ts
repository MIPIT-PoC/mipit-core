jest.mock('../../../src/observability/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

import { IdempotencyRepository, type IdempotencyRecord } from '../../../src/persistence/repositories/idempotency.repository';
import { logger } from '../../../src/observability/logger';

function createMockPool() {
  return { query: jest.fn() } as unknown as import('pg').Pool;
}

describe('IdempotencyRepository', () => {
  let db: ReturnType<typeof createMockPool>;
  let repo: IdempotencyRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    db = createMockPool();
    repo = new IdempotencyRepository(db);
  });

  it('findByKey returns null if key does not exist', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
    const result = await repo.findByKey('nonexistent');
    expect(result).toBeNull();
  });

  it('findByKey returns the record when it exists', async () => {
    const record: IdempotencyRecord = {
      idempotency_key: 'key1',
      payment_id: 'PMT-1',
      request_hash: 'abc',
      response_status: 200,
      response_body: { ok: true },
      created_at: '2025-01-01T00:00:00Z',
      expires_at: '2025-01-02T00:00:00Z',
    };
    (db.query as jest.Mock).mockResolvedValue({ rows: [record] });

    const result = await repo.findByKey('key1');
    expect(result).toEqual(record);
  });

  it('findByKey query includes expires_at > NOW()', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
    await repo.findByKey('key1');
    const sql = (db.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toContain('expires_at > NOW()');
  });

  it('insert passes 6 parameters including payment_id', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
    const record: IdempotencyRecord = {
      idempotency_key: 'k1',
      payment_id: 'PMT-1',
      request_hash: 'hash',
      response_status: 202,
      response_body: { id: 'test' },
      created_at: '2025-01-01T00:00:00Z',
    };
    await repo.insert(record);

    const params = (db.query as jest.Mock).mock.calls[0][1] as unknown[];
    expect(params).toHaveLength(6);
    expect(params[1]).toBe('PMT-1');
  });

  it('insert serializes response_body as JSON', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
    const record: IdempotencyRecord = {
      idempotency_key: 'k2',
      payment_id: 'PMT-2',
      request_hash: 'hash',
      response_body: { id: 'test' },
      created_at: '2025-01-01T00:00:00Z',
    };
    await repo.insert(record);

    const params = (db.query as jest.Mock).mock.calls[0][1] as unknown[];
    expect(params[4]).toBe('{"id":"test"}');
  });

  it('insert passes null if response_body is undefined', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
    const record: IdempotencyRecord = {
      idempotency_key: 'k3',
      payment_id: 'PMT-3',
      request_hash: 'hash',
      created_at: '2025-01-01T00:00:00Z',
    };
    await repo.insert(record);

    const params = (db.query as jest.Mock).mock.calls[0][1] as unknown[];
    expect(params[4]).toBeNull();
  });

  it('updateResponse serializes body and passes status in order', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
    await repo.updateResponse('key1', 202, { payment_id: 'PMT-1' });

    const params = (db.query as jest.Mock).mock.calls[0][1] as unknown[];
    expect(params).toEqual([202, '{"payment_id":"PMT-1"}', 'key1']);
  });

  it('logs debug in each method with correct context', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });

    await repo.findByKey('key1');
    expect(logger.debug).toHaveBeenCalledWith(
      { idempotency_key: 'key1', found: false },
      'Idempotency lookup',
    );

    jest.clearAllMocks();
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
    await repo.insert({
      idempotency_key: 'k1',
      payment_id: 'PMT-1',
      request_hash: 'h',
      created_at: '2025-01-01T00:00:00Z',
    });
    expect(logger.debug).toHaveBeenCalledWith(
      { idempotency_key: 'k1', payment_id: 'PMT-1' },
      'Idempotency key inserted',
    );

    jest.clearAllMocks();
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
    await repo.updateResponse('key1', 202, { ok: true });
    expect(logger.debug).toHaveBeenCalledWith(
      { idempotency_key: 'key1', status: 202 },
      'Idempotency response cached',
    );
  });
});
