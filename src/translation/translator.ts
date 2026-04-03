import type { CanonicalPacs008 } from '../domain/models/canonical.js';
import type { Rail } from '../config/constants.js';
import type { MappingLoader } from './mapping-loader.js';
import { pixToCanonical } from './pix-to-canonical.js';
import { speiToCanonical } from './spei-to-canonical.js';
import { canonicalToPix } from './canonical-to-pix.js';
import { canonicalToSpei } from './canonical-to-spei.js';
import { swiftMt103ToCanonical } from './swift-mt103-to-canonical.js';
import { canonicalToSwiftMt103 } from './canonical-to-swift-mt103.js';
import { iso20022MxToCanonical } from './iso20022-mx-to-canonical.js';
import { canonicalToIso20022Mx } from './canonical-to-iso20022-mx.js';
import { achNachaToCanonical } from './ach-nacha-to-canonical.js';
import { canonicalToAchNacha } from './canonical-to-ach-nacha.js';
import { fednowToCanonical } from './fednow-to-canonical.js';
import { canonicalToFednow } from './canonical-to-fednow.js';
import { brebToCanonical } from './breb-to-canonical.js';
import { canonicalToBreb } from './canonical-to-breb.js';
import { TranslationError } from '../domain/errors/index.js';
import { logger } from '../observability/logger.js';
import { startLatencyTimer, recordTranslationError } from '../observability/metrics.js';

export class Translator {
  constructor(private readonly mappingLoader: MappingLoader) {}

  /**
   * Translates a rail-native payload to the canonical pacs.008 model.
   * Supported: PIX, SPEI, SWIFT_MT103, ISO20022_MX, ACH_NACHA, FEDNOW, BRE_B
   */
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
          result = await pixToCanonical(payload, paymentId, this.mappingLoader, traceId);
          break;
        case 'SPEI':
          result = await speiToCanonical(payload, paymentId, this.mappingLoader, traceId);
          break;
        case 'SWIFT_MT103':
          result = await swiftMt103ToCanonical(
            payload as Parameters<typeof swiftMt103ToCanonical>[0],
            paymentId,
            traceId,
          );
          break;
        case 'ISO20022_MX':
          result = await iso20022MxToCanonical(payload as Record<string, unknown>, paymentId, traceId);
          break;
        case 'ACH_NACHA':
          result = await achNachaToCanonical(payload as Record<string, unknown>, paymentId, traceId);
          break;
        case 'FEDNOW':
          result = await fednowToCanonical(payload as Record<string, unknown>, paymentId, traceId);
          break;
        case 'BRE_B':
          result = await brebToCanonical(payload as Record<string, unknown>, paymentId, traceId);
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

  /**
   * Translates a canonical pacs.008 to a rail-native format.
   * Supported: PIX, SPEI, SWIFT_MT103, ISO20022_MX, ACH_NACHA, FEDNOW, BRE_B
   */
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
        case 'SWIFT_MT103':
          result = await canonicalToSwiftMt103(canonical);
          break;
        case 'ISO20022_MX':
          result = await canonicalToIso20022Mx(canonical);
          break;
        case 'ACH_NACHA':
          result = await canonicalToAchNacha(canonical);
          break;
        case 'FEDNOW':
          result = await canonicalToFednow(canonical);
          break;
        case 'BRE_B':
          result = await canonicalToBreb(canonical);
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

  /**
   * Translates directly between two rails via the canonical model.
   * source → canonical → destination
   */
  async translate(
    sourceRail: Rail | string,
    destinationRail: Rail | string,
    payload: unknown,
    paymentId: string,
    traceId?: string,
  ): Promise<{ canonical: CanonicalPacs008; translated: unknown }> {
    const log = logger.child({ sourceRail, destinationRail, payment_id: paymentId });
    log.info('Starting cross-rail translation');
    const canonical = await this.toCanonical(sourceRail, payload, paymentId, traceId);
    const translated = await this.fromCanonical(destinationRail, canonical);
    log.info('Cross-rail translation complete');
    return { canonical, translated };
  }
}
