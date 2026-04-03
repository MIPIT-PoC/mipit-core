import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ulid } from 'ulid';
import { SUPPORTED_RAILS } from '../../domain/models/canonical.js';
import { TranslationError } from '../../domain/errors/index.js';
import { logger } from '../../observability/logger.js';
import type { Translator } from '../../translation/translator.js';
import type { MappingLoader } from '../../translation/mapping-loader.js';

export interface TranslateRouteDeps {
  translator: Translator;
  mappingLoader: MappingLoader;
}

const translateRequestSchema = z.object({
  sourceRail: z.enum(SUPPORTED_RAILS, {
    errorMap: () => ({ message: `sourceRail must be one of: ${SUPPORTED_RAILS.join(', ')}` }),
  }),
  destinationRail: z.enum(SUPPORTED_RAILS, {
    errorMap: () => ({ message: `destinationRail must be one of: ${SUPPORTED_RAILS.join(', ')}` }),
  }),
  payload: z.record(z.unknown()),
  options: z.object({
    includeCanonical: z.boolean().default(true),
    paymentId: z.string().optional(),
  }).optional().default({}),
});

export type TranslateRequest = z.infer<typeof translateRequestSchema>;

export async function translateRoutes(app: FastifyInstance, deps: TranslateRouteDeps) {
  const { translator } = deps;

  /**
   * POST /translate
   * Translates a payment message from one rail format to another.
   * Does NOT send the payment — pure format conversion.
   */
  app.post('/translate', async (request, reply) => {
    const traceId = (request as unknown as Record<string, unknown>).traceId as string;
    const body = translateRequestSchema.parse(request.body);
    const log = logger.child({
      source: body.sourceRail,
      destination: body.destinationRail,
      trace_id: traceId,
    });

    if (body.sourceRail === body.destinationRail) {
      return reply.status(400).send({
        error: 'INVALID_TRANSLATION',
        message: 'Source and destination rails must be different',
      });
    }

    try {
      const paymentId = body.options?.paymentId ?? `PMT-${ulid()}`;

      log.info({ paymentId }, 'Translation request received');

      const { canonical, translated } = await translator.translate(
        body.sourceRail,
        body.destinationRail,
        body.payload,
        paymentId,
        traceId,
      );

      const response: Record<string, unknown> = {
        paymentId,
        sourceRail: body.sourceRail,
        destinationRail: body.destinationRail,
        translated,
        translatedAt: new Date().toISOString(),
        traceId,
      };

      if (body.options?.includeCanonical !== false) {
        response.canonical = canonical;
      }

      log.info({ paymentId }, 'Translation successful');
      return reply.status(200).send(response);
    } catch (err) {
      if (err instanceof TranslationError) {
        log.warn({ err }, 'Translation error');
        return reply.status(422).send({
          error: 'TRANSLATION_ERROR',
          message: err.message,
          details: err.details,
        });
      }
      log.error({ err }, 'Unexpected translation error');
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'Unexpected error during translation',
      });
    }
  });

  /**
   * GET /translate/rails
   * Returns list of supported rails and their metadata.
   */
  app.get('/translate/rails', async (_request, reply) => {
    const { RAIL_METADATA } = await import('../../config/constants.js');
    return reply.send({
      rails: SUPPORTED_RAILS.map((rail) => ({
        id: rail,
        ...RAIL_METADATA[rail as keyof typeof RAIL_METADATA],
      })),
      totalRails: SUPPORTED_RAILS.length,
    });
  });

  /**
   * POST /translate/preview
   * Translates and returns ALL possible destination formats simultaneously.
   * Useful for the UI translator page.
   */
  app.post('/translate/preview', async (request, reply) => {
    const traceId = (request as unknown as Record<string, unknown>).traceId as string;
    const partialSchema = z.object({
      sourceRail: z.enum(SUPPORTED_RAILS),
      payload: z.record(z.unknown()),
    });

    const body = partialSchema.parse(request.body);
    const paymentId = `PMT-${ulid()}`;
    const log = logger.child({ source: body.sourceRail, trace_id: traceId, paymentId });

    log.info('Translation preview request received');

    try {
      const canonical = await translator.toCanonical(
        body.sourceRail,
        body.payload,
        paymentId,
        traceId,
      );

      // Translate to all other rails in parallel
      const otherRails = SUPPORTED_RAILS.filter(r => r !== body.sourceRail);
      const translationResults = await Promise.allSettled(
        otherRails.map(async (destRail) => {
          const translated = await translator.fromCanonical(destRail, canonical);
          return { rail: destRail, translated, success: true };
        }),
      );

      const translations: Record<string, unknown> = {};
      for (let i = 0; i < otherRails.length; i++) {
        const result = translationResults[i];
        const rail = otherRails[i];
        if (result.status === 'fulfilled') {
          translations[rail] = { success: true, data: result.value.translated };
        } else {
          translations[rail] = { success: false, error: result.reason?.message ?? 'Translation failed' };
        }
      }

      return reply.status(200).send({
        paymentId,
        sourceRail: body.sourceRail,
        canonical,
        translations,
        translatedAt: new Date().toISOString(),
        traceId,
      });
    } catch (err) {
      if (err instanceof TranslationError) {
        return reply.status(422).send({
          error: 'TRANSLATION_ERROR',
          message: err.message,
          details: err.details,
        });
      }
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Unexpected error' });
    }
  });
}
