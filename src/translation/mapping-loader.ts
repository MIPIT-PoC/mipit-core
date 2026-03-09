import type { MappingEntry } from '../domain/models/mapping-entry.js';
import type { MappingRepository } from '../persistence/repositories/mapping.repository.js';

export type { MappingEntry } from '../domain/models/mapping-entry.js';

export class MappingLoader {
  constructor(private readonly repo: MappingRepository) {}

  async loadMappings(rail: string, direction: string): Promise<MappingEntry[]> {
    return this.repo.findByRail(rail, direction);
  }
}
