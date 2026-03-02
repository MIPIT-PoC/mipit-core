import type { CanonicalPacs008 } from '../domain/models/canonical.js';
import type { Rail } from '../config/constants.js';
import { pixToCanonical } from './pix-to-canonical.js';
import { speiToCanonical } from './spei-to-canonical.js';
import { canonicalToPix } from './canonical-to-pix.js';
import { canonicalToSpei } from './canonical-to-spei.js';
import { TranslationError } from '../domain/errors/index.js';

export class Translator {
  async toCanonical(
    rail: Rail | string,
    payload: unknown,
    paymentId: string,
    traceId?: string,
  ): Promise<CanonicalPacs008> {
    switch (rail) {
      case 'PIX':
        return pixToCanonical(payload, paymentId, traceId);
      case 'SPEI':
        return speiToCanonical(payload, paymentId, traceId);
      default:
        throw new TranslationError(rail, `Unsupported origin rail: ${rail}`);
    }
  }

  async fromCanonical(
    destinationRail: Rail | string,
    canonical: CanonicalPacs008,
  ): Promise<unknown> {
    switch (destinationRail) {
      case 'PIX':
        return canonicalToPix(canonical);
      case 'SPEI':
        return canonicalToSpei(canonical);
      default:
        throw new TranslationError(destinationRail, `Unsupported destination rail: ${destinationRail}`);
    }
  }
}
