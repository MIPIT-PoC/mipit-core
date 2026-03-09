jest.mock('../../../src/observability/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

import { MappingRepository } from '../../../src/persistence/repositories/mapping.repository';
import type { MappingEntry } from '../../../src/domain/models/mapping-entry';
import { logger } from '../../../src/observability/logger';

function createMockPool() {
  return { query: jest.fn() } as unknown as import('pg').Pool;
}

const sampleEntries: MappingEntry[] = [
  {
    id: 1,
    rail: 'PIX',
    direction: 'TO_CANONICAL',
    source_field: 'valor',
    target_field: 'amount.value',
    transformation: 'parse_decimal',
    is_active: true,
    created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 2,
    rail: 'PIX',
    direction: 'TO_CANONICAL',
    source_field: 'pagador.nome',
    target_field: 'debtor.name',
    transformation: 'direct_copy',
    is_active: true,
    created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 3,
    rail: 'PIX',
    direction: 'TO_CANONICAL',
    source_field: 'recebedor.nome',
    target_field: 'creditor.name',
    transformation: 'direct_copy',
    is_active: true,
    created_at: '2025-01-01T00:00:00Z',
  },
];

const mixedEntries: MappingEntry[] = [
  ...sampleEntries,
  {
    id: 4,
    rail: 'SPEI',
    direction: 'TO_CANONICAL',
    source_field: 'monto',
    target_field: 'amount.value',
    transformation: 'parse_decimal',
    is_active: true,
    created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 5,
    rail: 'PIX',
    direction: 'FROM_CANONICAL',
    source_field: 'amount.value',
    target_field: 'valor',
    transformation: 'format_decimal',
    is_active: true,
    created_at: '2025-01-01T00:00:00Z',
  },
];

describe('MappingRepository', () => {
  let db: ReturnType<typeof createMockPool>;
  let repo: MappingRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    db = createMockPool();
    repo = new MappingRepository(db);
  });

  it('findByRail returns entries filtered by rail and direction', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: sampleEntries });

    const result = await repo.findByRail('PIX', 'TO_CANONICAL');

    const params = (db.query as jest.Mock).mock.calls[0][1] as unknown[];
    expect(params).toEqual(['PIX', 'TO_CANONICAL']);
    expect(result).toHaveLength(3);
    expect(result).toEqual(sampleEntries);
  });

  it('findByRail returns empty array if no mappings', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
    const result = await repo.findByRail('UNKNOWN', 'TO_CANONICAL');
    expect(result).toEqual([]);
  });

  it('findByRail query uses rail, direction, and is_active', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
    await repo.findByRail('PIX', 'TO_CANONICAL');
    const sql = (db.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toContain('rail = $1');
    expect(sql).toContain('direction = $2');
    expect(sql).toContain('is_active = true');
  });

  it('findAll returns all active entries', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: mixedEntries });
    const result = await repo.findAll();
    expect(result).toHaveLength(5);
    expect(result).toEqual(mixedEntries);
  });

  it('findAll query uses is_active', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
    await repo.findAll();
    const sql = (db.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toContain('is_active = true');
  });

  it('logs debug in both methods with correct context', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: sampleEntries });
    await repo.findByRail('PIX', 'TO_CANONICAL');
    expect(logger.debug).toHaveBeenCalledWith(
      { rail: 'PIX', direction: 'TO_CANONICAL', count: 3 },
      'Loaded mapping entries',
    );

    jest.clearAllMocks();
    (db.query as jest.Mock).mockResolvedValue({ rows: mixedEntries });
    await repo.findAll();
    expect(logger.debug).toHaveBeenCalledWith(
      { count: 5 },
      'Loaded all mapping entries',
    );
  });

  it('MappingEntry interface has the correct schema fields', () => {
    const entry: MappingEntry = {
      id: 1,
      rail: 'PIX',
      direction: 'TO_CANONICAL',
      source_field: 'valor',
      target_field: 'amount.value',
      transformation: 'parse_decimal',
      is_active: true,
      created_at: '2025-01-01T00:00:00Z',
    };
    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('rail');
    expect(entry).toHaveProperty('direction');
    expect(entry).toHaveProperty('source_field');
    expect(entry).toHaveProperty('target_field');
    expect(entry).toHaveProperty('transformation');
    expect(entry).toHaveProperty('is_active');
    expect(entry).not.toHaveProperty('source_rail');
    expect(entry).not.toHaveProperty('canonical_field');
    expect(entry).not.toHaveProperty('transform');
    expect(entry).not.toHaveProperty('active');
  });

  it('findByRail differentiates TO_CANONICAL and FROM_CANONICAL', async () => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });

    await repo.findByRail('PIX', 'TO_CANONICAL');
    await repo.findByRail('PIX', 'FROM_CANONICAL');

    expect(db.query).toHaveBeenCalledTimes(2);
    const call1Params = (db.query as jest.Mock).mock.calls[0][1] as unknown[];
    const call2Params = (db.query as jest.Mock).mock.calls[1][1] as unknown[];
    expect(call1Params).toEqual(['PIX', 'TO_CANONICAL']);
    expect(call2Params).toEqual(['PIX', 'FROM_CANONICAL']);
  });
});
