import { RouteEngine } from '../../../src/routing/route-engine.js';
import type { RuleLoader } from '../../../src/routing/rule-loader.js';
import type { RouteRule } from '../../../src/domain/models/route-rule.js';
import { RoutingError } from '../../../src/domain/errors/index.js';

describe('RouteEngine', () => {
  const mockRuleLoader: jest.Mocked<RuleLoader> = {
    loadActiveRules: jest.fn(),
  } as unknown as jest.Mocked<RuleLoader>;

  let routeEngine: RouteEngine;

  beforeEach(() => {
    routeEngine = new RouteEngine(mockRuleLoader);
    jest.clearAllMocks();
  });

  it.todo('should match a rule by origin_rail');

  it.todo('should match a rule by currency');

  it.todo('should match a rule by amount range');

  it.todo('should return the highest-priority matching rule');

  it.todo('should throw RoutingError when no rule matches');
});
