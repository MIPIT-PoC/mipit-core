import type { MappingEntry } from '../domain/models/mapping-entry.js';
import type { MappingRepository } from '../persistence/repositories/mapping.repository.js';
import { logger } from '../observability/logger.js';

export type { MappingEntry } from '../domain/models/mapping-entry.js';

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  entries: MappingEntry[];
  loadedAt: number;
}

export class MappingLoader {
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly repo: MappingRepository) {}

  async loadMappings(rail: string, direction: string): Promise<MappingEntry[]> {
    const key = `${rail}:${direction}`;
    const cached = this.cache.get(key);

    if (cached && Date.now() - cached.loadedAt < TTL_MS) {
      logger.debug({ rail, direction, source: 'cache' }, 'Mapping cache hit');
      return cached.entries;
    }

    const entries = await this.repo.findByRail(rail, direction);
    this.cache.set(key, { entries, loadedAt: Date.now() });
    logger.debug({ rail, direction, count: entries.length, source: 'db' }, 'Mappings loaded from DB');
    return entries;
  }

  clearCache(): void {
    this.cache.clear();
    logger.debug('Mapping cache cleared');
  }
}
