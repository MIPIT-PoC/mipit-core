import type { FastifyInstance } from 'fastify';
import { logger } from '../../observability/logger.js';
import { z } from 'zod';

// AlertManager v4 webhook payload — https://prometheus.io/docs/alerting/latest/configuration/#webhook_config
const alertSchema = z.object({
  status: z.enum(['firing', 'resolved']),
  labels: z.record(z.string()).optional(),
  annotations: z.record(z.string()).optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  generatorURL: z.string().optional(),
});

const alertManagerWebhookSchema = z.object({
  version: z.string().optional(),
  groupKey: z.string().optional(),
  status: z.enum(['firing', 'resolved']),
  receiver: z.string().optional(),
  groupLabels: z.record(z.string()).optional(),
  commonLabels: z.record(z.string()).optional(),
  commonAnnotations: z.record(z.string()).optional(),
  externalURL: z.string().optional(),
  alerts: z.array(alertSchema).default([]),
});

/**
 * W5.2 — POST /webhooks/alertmanager
 *
 * Receives AlertManager v4 webhook payloads and logs them with severity-aware
 * levels. Public endpoint (no JWT) because AlertManager is a machine-to-machine
 * client running in the internal Docker network.
 *
 * Wired in mipit-observability/alertmanager/alertmanager.yml:24
 *   receivers:
 *     - name: mipit-core-webhook
 *       webhook_configs:
 *         - url: http://core:8080/webhooks/alertmanager
 */
export async function registerWebhookRoutes(app: FastifyInstance) {
  app.post('/webhooks/alertmanager', async (request, reply) => {
    const parsed = alertManagerWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      logger.warn(
        { error: parsed.error.flatten() },
        'AlertManager webhook payload failed validation — accepted anyway',
      );
      return reply.status(200).send({ received: true, parsed: false });
    }

    const { status, alerts, commonLabels, commonAnnotations, externalURL } = parsed.data;
    const isFiring = status === 'firing';

    // Log a summary line at warn (firing) / info (resolved)
    const summary = {
      alertmanager: {
        group_status: status,
        alert_count: alerts.length,
        receiver: parsed.data.receiver,
        external_url: externalURL,
        common_labels: commonLabels,
        common_annotations: commonAnnotations,
      },
    };
    if (isFiring) {
      logger.warn(summary, `AlertManager: ${alerts.length} alert(s) firing`);
    } else {
      logger.info(summary, `AlertManager: ${alerts.length} alert(s) resolved`);
    }

    // Per-alert detail at debug — keeps top-level logs scannable
    for (const alert of alerts) {
      logger.debug(
        {
          alert: {
            status: alert.status,
            alertname: alert.labels?.alertname,
            severity: alert.labels?.severity,
            instance: alert.labels?.instance,
            job: alert.labels?.job,
            description: alert.annotations?.description,
            summary: alert.annotations?.summary,
            starts_at: alert.startsAt,
            ends_at: alert.endsAt,
          },
        },
        `AlertManager alert ${alert.status}: ${alert.labels?.alertname ?? 'unknown'}`,
      );
    }

    return reply.status(200).send({ received: true, parsed: true, count: alerts.length });
  });
}
