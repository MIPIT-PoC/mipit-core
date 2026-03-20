jest.mock('../../../src/observability/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

import { MappingLoader } from '../../../src/translation/mapping-loader.js';
import type { MappingRepository } from '../../../src/persistence/repositories/mapping.repository.js';
import type { MappingEntry } from '../../../src/domain/models/mapping-entry.js';
import { logger } from '../../../src/observability/logger.js';

const mockRepo: jest.Mocked<MappingRepository> = {
  findByRail: jest.fn(),
  findAll: jest.fn(),
} as unknown as jest.Mocked<MappingRepository>;

const createMockEntry = (
  sourceField: string,
  targetField: string = 'target',
  transformation: string = 'identity',
  validationRule?: string,
  isActive: boolean = true,
): MappingEntry => ({
  id: 1,
  rail: 'PIX',
  direction: 'TO_CANONICAL',
  source_field: sourceField,
  target_field: targetField,
  transformation,
  validation_rule: validationRule,
  is_active: isActive,
  created_at: new Date().toISOString(),
});

describe('MappingLoader', () => {
  let loader: MappingLoader;
  let dateNowSpy: jest.SpyInstance;

  beforeEach(() => {
    loader = new MappingLoader(mockRepo);
    jest.clearAllMocks();
    dateNowSpy = jest.spyOn(Date, 'now');
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  it('should query DB on first call and transform entries to Map', async () => {
    const entries: MappingEntry[] = [createMockEntry('field_a', 'fieldA', 'uppercase')];
    mockRepo.findByRail.mockResolvedValue(entries);
    dateNowSpy.mockReturnValue(1000);

    const result = await loader.loadMappings('PIX', 'TO_CANONICAL');
    
    expect(result instanceof Map).toBe(true);
    expect(result.size).toBe(1);
    expect(result.get('field_a')).toEqual({
      targetField: 'fieldA',
      transformation: 'uppercase',
      validation: undefined,
    });
    expect(mockRepo.findByRail).toHaveBeenCalledWith('PIX', 'TO_CANONICAL');
  });

  it('should filter out inactive entries', async () => {
    const entries: MappingEntry[] = [
      createMockEntry('field_a', 'fieldA', 'lowercase', undefined, true),
      createMockEntry('field_b', 'fieldB', 'uppercase', undefined, false),
    ];
    mockRepo.findByRail.mockResolvedValue(entries);
    dateNowSpy.mockReturnValue(1000);

    const result = await loader.loadMappings('PIX', 'TO_CANONICAL');
    
    expect(result.size).toBe(1);
    expect(result.has('field_a')).toBe(true);
    expect(result.has('field_b')).toBe(false);
  });

  it('should include validation rule when present', async () => {
    const entries: MappingEntry[] = [
      createMockEntry('amount', 'amount', 'decimal', 'numeric_positive'),
    ];
    mockRepo.findByRail.mockResolvedValue(entries);
    dateNowSpy.mockReturnValue(1000);

    const result = await loader.loadMappings('PIX', 'TO_CANONICAL');
    
    expect(result.get('amount')).toEqual({
      targetField: 'amount',
      transformation: 'decimal',
      validation: 'numeric_positive',
    });
  });

  it('should return cached result on second call within TTL', async () => {
    const entries: MappingEntry[] = [createMockEntry('field_a')];
    mockRepo.findByRail.mockResolvedValue(entries);
    dateNowSpy.mockReturnValue(1000);

    const result1 = await loader.loadMappings('PIX', 'TO_CANONICAL');
    dateNowSpy.mockReturnValue(1000 + 4 * 60 * 1000);

    const result2 = await loader.loadMappings('PIX', 'TO_CANONICAL');
    expect(result1 === result2).toBe(true); // Same reference
    expect(mockRepo.findByRail).toHaveBeenCalledTimes(1);
  });

  it('should reload after TTL expires', async () => {
    const entries1: MappingEntry[] = [createMockEntry('field_a')];
    const entries2: MappingEntry[] = [createMockEntry('field_b')];
    mockRepo.findByRail.mockResolvedValueOnce(entries1).mockResolvedValueOnce(entries2);
    dateNowSpy.mockReturnValue(1000);

    const result1 = await loader.loadMappings('PIX', 'TO_CANONICAL');
    expect(result1.size).toBe(1);
    expect(result1.has('field_a')).toBe(true);

    dateNowSpy.mockReturnValue(1000 + 5 * 60 * 1000 + 1);
    const result2 = await loader.loadMappings('PIX', 'TO_CANONICAL');
    expect(result2.size).toBe(1);
    expect(result2.has('field_b')).toBe(true);
    expect(mockRepo.findByRail).toHaveBeenCalledTimes(2);
  });

  it('should not share cache between different keys', async () => {
    const pixEntries: MappingEntry[] = [createMockEntry('pix_field')];
    const speiEntries: MappingEntry[] = [createMockEntry('spei_field')];
    
    mockRepo.findByRail
      .mockResolvedValueOnce(pixEntries)
      .mockResolvedValueOnce(speiEntries);
    dateNowSpy.mockReturnValue(1000);

    const pixResult = await loader.loadMappings('PIX', 'TO_CANONICAL');
    const speiResult = await loader.loadMappings('SPEI', 'TO_CANONICAL');
    
    expect(pixResult.has('pix_field')).toBe(true);
    expect(speiResult.has('spei_field')).toBe(true);
    expect(pixResult === speiResult).toBe(false);
    expect(mockRepo.findByRail).toHaveBeenCalledTimes(2);
  });

  it('should force reload after clearCache', async () => {
    const entries: MappingEntry[] = [createMockEntry('field_a')];
    mockRepo.findByRail.mockResolvedValue(entries);
    dateNowSpy.mockReturnValue(1000);

    await loader.loadMappings('PIX', 'TO_CANONICAL');
    loader.clearCache();
    await loader.loadMappings('PIX', 'TO_CANONICAL');
    expect(mockRepo.findByRail).toHaveBeenCalledTimes(2);
  });

  it('should log cache hit and db load with correct source', async () => {
    mockRepo.findByRail.mockResolvedValue([createMockEntry('field_a')]);
    dateNowSpy.mockReturnValue(1000);

    await loader.loadMappings('PIX', 'TO_CANONICAL');
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'db' }),
      expect.any(String),
    );

    await loader.loadMappings('PIX', 'TO_CANONICAL');
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'cache' }),
      expect.any(String),
    );
  });

  it('should log correct mapping count', async () => {
    const entries: MappingEntry[] = [
      createMockEntry('field_a'),
      createMockEntry('field_b'),
      createMockEntry('field_c', 'fieldC', 'transform', undefined, false), // inactive
    ];
    mockRepo.findByRail.mockResolvedValue(entries);
    dateNowSpy.mockReturnValue(1000);

    await loader.loadMappings('PIX', 'TO_CANONICAL');
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ count: 2 }),
      expect.any(String),
    );
  });
});

