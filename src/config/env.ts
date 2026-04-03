import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development').describe('Application environment'),
  PORT: z.coerce.number().int().positive().default(8080).describe('Server port'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL URL').describe('PostgreSQL connection string'),
  RABBITMQ_URL: z.string().url('RABBITMQ_URL must be a valid AMQP URL').describe('RabbitMQ connection string'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters long').describe('JWT signing secret'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url('OTEL_EXPORTER_OTLP_ENDPOINT must be a valid URL').describe('OpenTelemetry OTLP endpoint'),
  OTEL_SERVICE_NAME: z.string().min(1, 'OTEL_SERVICE_NAME cannot be empty').default('mipit-core').describe('OpenTelemetry service name'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info').describe('Logging level'),
  OPEN_EXCHANGE_RATES_APP_ID: z.string().optional().describe('Open Exchange Rates API key (optional — uses fallback rates if not set)'),
  WEBHOOK_SECRET: z.string().min(16).optional().describe('HMAC secret for signing webhook payloads'),
});

function validateEnv() {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('\n  ');

      console.error('❌ Environment variables validation failed:\n  ' + missingVars);
      process.exit(1);
    }
    throw error;
  }
}

export const env = validateEnv();
export type Env = z.infer<typeof envSchema>;
