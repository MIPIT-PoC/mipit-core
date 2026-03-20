import type { MappingRepository } from '../persistence/repositories/mapping.repository.js';
import { logger } from '../observability/logger.js';

export interface MappingTransform {
  targetField: string;
  transformation: string;
  validation?: string;
}

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  mappings: Map<string, MappingTransform>;
  loadedAt: number;
}

export class MappingLoader {
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly repo: MappingRepository) {}

  async loadMappings(rail: string, direction: string): Promise<Map<string, MappingTransform>> {
    const key = `${rail}:${direction}`;
    const cached = this.cache.get(key);

    if (cached && Date.now() - cached.loadedAt < TTL_MS) {
      logger.debug({ rail, direction, source: 'cache' }, 'Mapping cache hit');
      return cached.mappings;
    }

    const entries = await this.repo.findByRail(rail, direction);
    const mappings = new Map<string, MappingTransform>();

    for (const entry of entries) {
      if (entry.is_active) {
        mappings.set(entry.source_field, {
          targetField: entry.target_field,
          transformation: entry.transformation,
          validation: entry.validation_rule,
        });
      }
    }

    this.cache.set(key, { mappings, loadedAt: Date.now() });
    logger.debug({ rail, direction, count: mappings.size, source: 'db' }, 'Mappings loaded from DB');
    return mappings;
  }

  clearCache(): void {
    this.cache.clear();
    logger.debug('Mapping cache cleared');
  }
}
