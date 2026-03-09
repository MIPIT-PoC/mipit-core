jest.mock('../../../src/observability/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

import { RouteRuleRepository } from '../../../src/persistence/repositories/route-rule.repository';
import type { RouteRule } from '../../../src/domain/models/route-rule';
import { logger } from '../../../src/observability/logger';

function createMockPool() {
  return { query: jest.fn() } as unknown as import('pg').Pool;
}

const sampleRules: RouteRule[] = [
  {
    id: 1,
    rule_name: 'pix_key_to_pix',
    condition_field: 'alias.type',
    condition_value: 'PIX_KEY',
    destination_rail: 'PIX',
    priority: 1,
    is_active: true,
    created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 2,
    rule_name: 'clabe_to_spei',
    condition_field: 'alias.type',
    condition_value: 'CLABE',
    destination_rail: 'SPEI',
    priority: 2,
    is_active: true,
    created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 3,
    rule_name: 'brazil_country',
    condition_field: 'destination_country',
    condition_value: 'BR',
    destination_rail: 'PIX',
    priority: 3,
    is_active: true,
    created_at: '2025-01-01T00:00:00Z',
  },
];

describe('RouteRuleRepository', () => {
  let db: ReturnType<typeof createMockPool>;
  let repo: RouteRuleRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    db = createMockPool();
    repo = new RouteRuleRepository(db);
  });

  it('findActive returns rules sorted by priority', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: sampleRules });

    const result = await repo.findActive();
    expect(result).toHaveLength(3);
    expect(result).toEqual(sampleRules);

    const sql = (db.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toContain('ORDER BY priority ASC');
  });

  it('findActive returns empty array if no active rules', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
    const result = await repo.findActive();
    expect(result).toEqual([]);
  });

  it('findActive query uses is_active (not active)', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
    await repo.findActive();
    const sql = (db.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toContain('is_active = true');
  });

  it('findById returns the rule when it exists', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [sampleRules[0]] });
    const result = await repo.findById(1);
    expect(result).toEqual(sampleRules[0]);
    expect(result!.rule_name).toBe('pix_key_to_pix');
    expect(result!.condition_field).toBe('alias.type');
  });

  it('findById returns null when not found', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
    const result = await repo.findById(999);
    expect(result).toBeNull();
  });

  it('findById passes id as number, not string', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
    await repo.findById(1);
    const params = (db.query as jest.Mock).mock.calls[0][1] as unknown[];
    expect(params).toEqual([1]);
    expect(typeof params[0]).toBe('number');
  });

  it('logs debug in both methods with correct context', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: sampleRules });
    await repo.findActive();
    expect(logger.debug).toHaveBeenCalledWith(
      { count: 3 },
      'Loaded active route rules',
    );

    jest.clearAllMocks();
    (db.query as jest.Mock).mockResolvedValue({ rows: [sampleRules[0]] });
    await repo.findById(1);
    expect(logger.debug).toHaveBeenCalledWith(
      { id: 1, found: true },
      'Route rule lookup',
    );

    jest.clearAllMocks();
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
    await repo.findById(99);
    expect(logger.debug).toHaveBeenCalledWith(
      { id: 99, found: false },
      'Route rule lookup',
    );
  });

  it('RouteRule interface has the correct schema fields', () => {
    const rule: RouteRule = {
      id: 1,
      rule_name: 'test',
      condition_field: 'alias.type',
      condition_value: 'PIX_KEY',
      destination_rail: 'PIX',
      priority: 1,
      is_active: true,
      created_at: '2025-01-01T00:00:00Z',
    };
    expect(rule).toHaveProperty('id');
    expect(rule).toHaveProperty('rule_name');
    expect(rule).toHaveProperty('condition_field');
    expect(rule).toHaveProperty('condition_value');
    expect(rule).toHaveProperty('destination_rail');
    expect(rule).toHaveProperty('priority');
    expect(rule).toHaveProperty('is_active');
    expect(rule).toHaveProperty('created_at');
    expect(rule).not.toHaveProperty('name');
    expect(rule).not.toHaveProperty('active');
    expect(rule).not.toHaveProperty('origin_rail');
  });
});
