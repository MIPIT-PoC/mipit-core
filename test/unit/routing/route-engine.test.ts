jest.mock('../../../src/observability/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    child: jest.fn(() => ({
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    })),
  },
}));

jest.mock('../../../src/observability/metrics.js', () => ({
  startLatencyTimer: jest.fn(() => jest.fn()),
  recordRoutingDecision: jest.fn(),
}));

import { RouteEngine } from '../../../src/routing/route-engine.js';
import type { RuleLoader } from '../../../src/routing/rule-loader.js';
import type { RouteRule } from '../../../src/domain/models/route-rule.js';
import { RoutingError } from '../../../src/domain/errors/index.js';
import { startLatencyTimer, recordRoutingDecision } from '../../../src/observability/metrics.js';
import type { CanonicalPacs008 } from '../../../src/domain/models/canonical.js';

function makeCanonical(overrides: Record<string, any> = {}): CanonicalPacs008 {
  return {
    payment_id: 'PMT-ABCDEFGHIJ1234567890',
    created_at: '2025-06-15T12:00:00.000Z',
    grpHdr: { msgId: 'MSG-001', creDtTm: '2025-06-15T12:00:00.000Z' },
    pmtId: { endToEndId: 'E2E-001' },
    amount: { value: 100, currency: 'BRL' },
    origin: { rail: 'PIX' },
    destination: {},
    debtor: { name: 'João', country: 'BR', account_id: 'PIX-d1' },
    creditor: { name: 'María', country: 'MX', account_id: 'PIX-cred-456' },
    alias: { type: 'PIX_KEY', value: 'cred-456' },
    purpose: 'P2P',
    reference: 'MIPIT-POC',
    status: 'RECEIVED',
    ...overrides,
  } as CanonicalPacs008;
}

function makeRule(overrides: Partial<RouteRule> = {}): RouteRule {
  return {
    id: 1,
    rule_name: 'pix_key_route',
    condition_field: 'alias.type',
    condition_value: 'PIX_KEY',
    destination_rail: 'PIX',
    priority: 10,
    is_active: true,
    created_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('RouteEngine', () => {
  const mockRuleLoader: jest.Mocked<RuleLoader> = {
    loadActiveRules: jest.fn(),
    clearCache: jest.fn(),
  } as unknown as jest.Mocked<RuleLoader>;

  let engine: RouteEngine;

  beforeEach(() => {
    engine = new RouteEngine(mockRuleLoader);
    jest.clearAllMocks();
  });

  it('should match rule by alias.type PIX_KEY for PIX-prefixed creditor', async () => {
    mockRuleLoader.loadActiveRules.mockResolvedValue([
      makeRule({ condition_field: 'alias.type', condition_value: 'PIX_KEY', destination_rail: 'PIX' }),
    ]);
    const canonical = makeCanonical({ creditor: { account_id: 'PIX-cred-456', name: 'Test' } });

    const result = await engine.resolve(canonical);
    expect(result.destination).toBe('PIX');
    expect(result.ruleName).toBe('pix_key_route');
  });

  it('should match rule by alias.type CLABE for SPEI-prefixed creditor', async () => {
    mockRuleLoader.loadActiveRules.mockResolvedValue([
      makeRule({ rule_name: 'clabe_route', condition_field: 'alias.type', condition_value: 'CLABE', destination_rail: 'SPEI' }),
    ]);
    const canonical = makeCanonical({ creditor: { account_id: 'SPEI-clabe-789', name: 'Test' } });

    const result = await engine.resolve(canonical);
    expect(result.destination).toBe('SPEI');
  });

  it('should match rule by destination_country', async () => {
    mockRuleLoader.loadActiveRules.mockResolvedValue([
      makeRule({ rule_name: 'country_mx', condition_field: 'destination_country', condition_value: 'MX', destination_rail: 'SPEI', priority: 5 }),
    ]);
    const canonical = makeCanonical({ creditor: { account_id: 'any', name: 'Test', country: 'MX' } });

    const result = await engine.resolve(canonical);
    expect(result.destination).toBe('SPEI');
  });

  it('should pick highest priority (lowest number) when multiple rules match', async () => {
    mockRuleLoader.loadActiveRules.mockResolvedValue([
      makeRule({ rule_name: 'low_priority', condition_field: 'alias.type', condition_value: 'PIX_KEY', destination_rail: 'PIX', priority: 20 }),
      makeRule({ rule_name: 'high_priority', condition_field: 'alias.type', condition_value: 'PIX_KEY', destination_rail: 'SPEI', priority: 5 }),
    ]);
    const canonical = makeCanonical({ creditor: { account_id: 'PIX-cred', name: 'Test' } });

    const result = await engine.resolve(canonical);
    expect(result.ruleName).toBe('high_priority');
    expect(result.destination).toBe('SPEI');
  });

  it('should throw RoutingError when no rule matches', async () => {
    mockRuleLoader.loadActiveRules.mockResolvedValue([
      makeRule({ condition_field: 'alias.type', condition_value: 'CLABE' }),
    ]);
    const canonical = makeCanonical({ creditor: { account_id: 'UNKNOWN-cred', name: 'Test' } });

    await expect(engine.resolve(canonical)).rejects.toThrow(RoutingError);
  });

  it('should record routing decision metric on match', async () => {
    mockRuleLoader.loadActiveRules.mockResolvedValue([
      makeRule({ rule_name: 'pix_key_route', destination_rail: 'PIX' }),
    ]);
    const canonical = makeCanonical({ creditor: { account_id: 'PIX-cred', name: 'Test' } });

    await engine.resolve(canonical);
    expect(recordRoutingDecision).toHaveBeenCalledWith('pix_key_route', 'PIX');
  });

  it('should start and stop latency timer', async () => {
    const stopFn = jest.fn();
    (startLatencyTimer as jest.Mock).mockReturnValue(stopFn);
    mockRuleLoader.loadActiveRules.mockResolvedValue([makeRule()]);
    const canonical = makeCanonical({ creditor: { account_id: 'PIX-cred', name: 'Test' } });

    await engine.resolve(canonical);
    expect(startLatencyTimer).toHaveBeenCalledWith('routing');
    expect(stopFn).toHaveBeenCalled();
  });

  it('should stop timer even on routing error', async () => {
    const stopFn = jest.fn();
    (startLatencyTimer as jest.Mock).mockReturnValue(stopFn);
    mockRuleLoader.loadActiveRules.mockResolvedValue([]);
    const canonical = makeCanonical();

    await expect(engine.resolve(canonical)).rejects.toThrow(RoutingError);
    expect(stopFn).toHaveBeenCalled();
  });
});
