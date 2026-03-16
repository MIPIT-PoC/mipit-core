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
import { logger } from '../../../src/observability/logger.js';

const mockRepo: jest.Mocked<MappingRepository> = {
  findByRail: jest.fn(),
  findAll: jest.fn(),
} as unknown as jest.Mocked<MappingRepository>;

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

  it('should query DB on first call', async () => {
    const entries = [{ source_field: 'a', target_field: 'b' }] as any[];
    mockRepo.findByRail.mockResolvedValue(entries);
    dateNowSpy.mockReturnValue(1000);

    const result = await loader.loadMappings('PIX', 'TO_CANONICAL');
    expect(result).toBe(entries);
    expect(mockRepo.findByRail).toHaveBeenCalledWith('PIX', 'TO_CANONICAL');
  });

  it('should return cached result on second call within TTL', async () => {
    const entries = [{ source_field: 'a' }] as any[];
    mockRepo.findByRail.mockResolvedValue(entries);
    dateNowSpy.mockReturnValue(1000);

    await loader.loadMappings('PIX', 'TO_CANONICAL');
    dateNowSpy.mockReturnValue(1000 + 4 * 60 * 1000);

    const result = await loader.loadMappings('PIX', 'TO_CANONICAL');
    expect(result).toEqual(entries);
    expect(mockRepo.findByRail).toHaveBeenCalledTimes(1);
  });

  it('should reload after TTL expires', async () => {
    const entries1 = [{ source_field: 'a' }] as any[];
    const entries2 = [{ source_field: 'b' }] as any[];
    mockRepo.findByRail.mockResolvedValueOnce(entries1).mockResolvedValueOnce(entries2);
    dateNowSpy.mockReturnValue(1000);

    await loader.loadMappings('PIX', 'TO_CANONICAL');

    dateNowSpy.mockReturnValue(1000 + 5 * 60 * 1000 + 1);
    const result = await loader.loadMappings('PIX', 'TO_CANONICAL');
    expect(result).toBe(entries2);
    expect(mockRepo.findByRail).toHaveBeenCalledTimes(2);
  });

  it('should not share cache between different keys', async () => {
    mockRepo.findByRail.mockResolvedValue([]);
    dateNowSpy.mockReturnValue(1000);

    await loader.loadMappings('PIX', 'TO_CANONICAL');
    await loader.loadMappings('SPEI', 'TO_CANONICAL');
    expect(mockRepo.findByRail).toHaveBeenCalledTimes(2);
    expect(mockRepo.findByRail).toHaveBeenCalledWith('PIX', 'TO_CANONICAL');
    expect(mockRepo.findByRail).toHaveBeenCalledWith('SPEI', 'TO_CANONICAL');
  });

  it('should force reload after clearCache', async () => {
    mockRepo.findByRail.mockResolvedValue([]);
    dateNowSpy.mockReturnValue(1000);

    await loader.loadMappings('PIX', 'TO_CANONICAL');
    loader.clearCache();
    await loader.loadMappings('PIX', 'TO_CANONICAL');
    expect(mockRepo.findByRail).toHaveBeenCalledTimes(2);
  });

  it('should log cache hit and db load with correct source', async () => {
    mockRepo.findByRail.mockResolvedValue([]);
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
});
