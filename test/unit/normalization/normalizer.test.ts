import { Normalizer } from '../../../src/normalization/normalizer.js';
import type { CanonicalPacs008 } from '../../../src/domain/models/canonical.js';

describe('Normalizer', () => {
  let normalizer: Normalizer;

  beforeEach(() => {
    normalizer = new Normalizer();
  });

  it.todo('should normalize dates to UTC ISO-8601 format');

  it.todo('should uppercase currency codes');

  it.todo('should populate missing msgId with generated value');

  it.todo('should populate missing endToEndId with generated value');

  it.todo('should apply default purpose P2P when missing');

  it.todo('should apply default reference MIPIT-POC when missing');

  it.todo('should not modify already-normalized fields');
});
