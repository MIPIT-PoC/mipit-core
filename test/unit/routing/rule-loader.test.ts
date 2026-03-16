jest.mock('../../../src/observability/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

import { RuleLoader } from '../../../src/routing/rule-loader.js';
import type { RouteRuleRepository } from '../../../src/persistence/repositories/route-rule.repository.js';
import { logger } from '../../../src/observability/logger.js';

const mockRepo: jest.Mocked<RouteRuleRepository> = {
  findActive: jest.fn(),
  findAll: jest.fn(),
} as unknown as jest.Mocked<RouteRuleRepository>;

describe('RuleLoader', () => {
  let loader: RuleLoader;
  let dateNowSpy: jest.SpyInstance;

  beforeEach(() => {
    loader = new RuleLoader(mockRepo);
    jest.clearAllMocks();
    dateNowSpy = jest.spyOn(Date, 'now');
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  it('should query DB on first call', async () => {
    const rules = [{ id: 1, rule_name: 'r1' }] as any[];
    mockRepo.findActive.mockResolvedValue(rules);
    dateNowSpy.mockReturnValue(1000);

    const result = await loader.loadActiveRules();
    expect(result).toBe(rules);
    expect(mockRepo.findActive).toHaveBeenCalledTimes(1);
  });

  it('should return cached result within TTL', async () => {
    const rules = [{ id: 1 }] as any[];
    mockRepo.findActive.mockResolvedValue(rules);
    dateNowSpy.mockReturnValue(1000);

    await loader.loadActiveRules();
    dateNowSpy.mockReturnValue(1000 + 4 * 60 * 1000);

    const result = await loader.loadActiveRules();
    expect(result).toEqual(rules);
    expect(mockRepo.findActive).toHaveBeenCalledTimes(1);
  });

  it('should reload after TTL expires', async () => {
    const rules1 = [{ id: 1 }] as any[];
    const rules2 = [{ id: 2 }] as any[];
    mockRepo.findActive.mockResolvedValueOnce(rules1).mockResolvedValueOnce(rules2);
    dateNowSpy.mockReturnValue(1000);

    await loader.loadActiveRules();
    dateNowSpy.mockReturnValue(1000 + 5 * 60 * 1000 + 1);

    const result = await loader.loadActiveRules();
    expect(result).toBe(rules2);
    expect(mockRepo.findActive).toHaveBeenCalledTimes(2);
  });

  it('should force reload after clearCache', async () => {
    mockRepo.findActive.mockResolvedValue([]);
    dateNowSpy.mockReturnValue(1000);

    await loader.loadActiveRules();
    loader.clearCache();
    await loader.loadActiveRules();
    expect(mockRepo.findActive).toHaveBeenCalledTimes(2);
  });

  it('should log source correctly', async () => {
    mockRepo.findActive.mockResolvedValue([]);
    dateNowSpy.mockReturnValue(1000);

    await loader.loadActiveRules();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'db' }),
      expect.any(String),
    );

    await loader.loadActiveRules();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'cache' }),
      expect.any(String),
    );
  });
});
