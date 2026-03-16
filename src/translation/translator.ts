import type { CanonicalPacs008 } from '../domain/models/canonical.js';
import type { Rail } from '../config/constants.js';
import { pixToCanonical } from './pix-to-canonical.js';
import { speiToCanonical } from './spei-to-canonical.js';
import { canonicalToPix } from './canonical-to-pix.js';
import { canonicalToSpei } from './canonical-to-spei.js';
import { TranslationError } from '../domain/errors/index.js';
import { logger } from '../observability/logger.js';
import { startLatencyTimer, recordTranslationError } from '../observability/metrics.js';

export class Translator {
  async toCanonical(
    rail: Rail | string,
    payload: unknown,
    paymentId: string,
    traceId?: string,
  ): Promise<CanonicalPacs008> {
    const stopTimer = startLatencyTimer('translation_to_canonical');
    const log = logger.child({ rail, payment_id: paymentId, direction: 'toCanonical' });

    try {
      log.info('Starting toCanonical translation');
      let result: CanonicalPacs008;

      switch (rail) {
        case 'PIX':
          result = await pixToCanonical(payload, paymentId, traceId);
          break;
        case 'SPEI':
          result = await speiToCanonical(payload, paymentId, traceId);
          break;
        default:
          throw new TranslationError(rail, `Unsupported origin rail: ${rail}`);
      }

      stopTimer();
      log.info({ currency: result.amount.currency }, 'toCanonical translation succeeded');
      return result;
    } catch (err) {
      stopTimer();
      const errorType = err instanceof TranslationError ? 'validation' : 'unexpected';
      recordTranslationError(rail, errorType);
      log.error({ err }, 'toCanonical translation failed');
      throw err;
    }
  }

  async fromCanonical(
    destinationRail: Rail | string,
    canonical: CanonicalPacs008,
  ): Promise<unknown> {
    const stopTimer = startLatencyTimer('translation_from_canonical');
    const log = logger.child({
      rail: destinationRail,
      payment_id: canonical.payment_id,
      direction: 'fromCanonical',
    });

    try {
      log.info('Starting fromCanonical translation');
      let result: unknown;

      switch (destinationRail) {
        case 'PIX':
          result = await canonicalToPix(canonical);
          break;
        case 'SPEI':
          result = await canonicalToSpei(canonical);
          break;
        default:
          throw new TranslationError(destinationRail, `Unsupported destination rail: ${destinationRail}`);
      }

      stopTimer();
      log.info('fromCanonical translation succeeded');
      return result;
    } catch (err) {
      stopTimer();
      const errorType = err instanceof TranslationError ? 'validation' : 'unexpected';
      recordTranslationError(destinationRail, errorType);
      log.error({ err }, 'fromCanonical translation failed');
      throw err;
    }
  }
}
