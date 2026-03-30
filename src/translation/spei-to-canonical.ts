import { ulid } from 'ulid';
import { canonicalPacs008Schema, type CanonicalPacs008 } from '../domain/models/canonical.js';
import type { CreatePaymentRequest } from '../api/schemas/payment-request.js';
import { TranslationError } from '../domain/errors/index.js';
import { logger } from '../observability/logger.js';
import type { MappingLoader } from './mapping-loader.js';

/**
 * Aplica transformaciones de mapeo a un valor
 */
function applyTransformation(value: unknown, transformation: string): unknown {
  switch (transformation) {
    case 'identity':
      return value;
    case 'uppercase':
      return typeof value === 'string' ? value.toUpperCase() : value;
    case 'lowercase':
      return typeof value === 'string' ? value.toLowerCase() : value;
    case 'strip_pix_prefix':
      return typeof value === 'string' && value.startsWith('PIX-') ? value.slice(4) : value;
    case 'strip_clabe_prefix':
      return typeof value === 'string' && value.startsWith('CLABE-') ? value.slice(6) : value;
    case 'numeric':
      return typeof value === 'number' ? value : Number(value);
    case 'string':
      return String(value);
    default:
      logger.warn({ transformation }, 'Unknown transformation, returning value as-is');
      return value;
  }
}

/**
 * Obtiene un valor usando notación de punto (e.g., "debtor.alias")
 */
function getNestedValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce((current, key) => {
    if (current && typeof current === 'object') {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Establece un valor usando notación de punto (e.g., "debtor.alias")
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  const lastKey = parts.pop()!;
  let current = obj;

  for (const part of parts) {
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[lastKey] = value;
}

/**
 * Validates a value against a validation rule string from the DB.
 * Supported formats: "regex:<pattern>", "minLength:<n>", "maxLength:<n>", "enum:<a,b,c>"
 */
function applyValidation(value: unknown, validation: string): boolean {
  const str = String(value ?? '');

  if (validation.startsWith('regex:')) {
    return new RegExp(validation.slice(6)).test(str);
  }
  if (validation.startsWith('minLength:')) {
    return str.length >= Number(validation.slice(10));
  }
  if (validation.startsWith('maxLength:')) {
    return str.length <= Number(validation.slice(10));
  }
  if (validation.startsWith('enum:')) {
    const allowed = validation.slice(5).split(',').map((s) => s.trim());
    return allowed.includes(str);
  }
  return true;
}

/**
 * Traduce un payload SPEI al modelo canónico pacs.008 usando mappings desde DB
 */
export async function speiToCanonical(
  payload: unknown,
  paymentId: string,
  mappingLoader: MappingLoader,
  traceId?: string,
): Promise<CanonicalPacs008> {
  const req = payload as CreatePaymentRequest;
  const now = new Date().toISOString();
  const log = logger.child({ payment_id: paymentId, rail: 'SPEI' });

  try {
    // Cargar mappings dinámicos desde DB
    const mappings = await mappingLoader.loadMappings('SPEI', 'TO_CANONICAL');
    log.debug({ mappings: mappings.size }, 'Loaded mappings for SPEI → Canonical');

    // Construir objeto con valores por defecto
    const raw: Record<string, unknown> = {
      payment_id: paymentId,
      created_at: now,
      grpHdr: { msgId: `MSG-${ulid()}`, creDtTm: now },
      pmtId: { endToEndId: `E2E-${ulid()}` },
      amount: {
        value: req.amount,
        currency: (req.currency ?? 'MXN').toUpperCase(),
      },
      fx: { source_currency: 'MXN' },
      origin: { rail: 'SPEI' as const },
      destination: { rail: undefined },
      debtor: {
        name: req.debtor.name,
        country: 'MX',
        account_id: req.debtor.alias,
      },
      creditor: {
        name: req.creditor.name,
        country: undefined,
        account_id: req.creditor.alias,
      },
      alias: { type: 'CLABE' as const, value: '' },
      purpose: req.purpose ?? 'P2P',
      reference: req.reference ?? 'MIPIT-POC',
      status: 'RECEIVED',
      trace_id: traceId,
    };

    // Aplicar mappings dinámicos
    let applicableCount = 0;
    for (const [sourceField, mapping] of mappings.entries()) {
      const sourceValue = getNestedValue(req, sourceField);

      if (sourceValue !== undefined && sourceValue !== null) {
        let transformedValue = applyTransformation(sourceValue, mapping.transformation);

        if (mapping.validation) {
          const valid = applyValidation(transformedValue, mapping.validation);
          if (!valid) {
            log.warn({ field: sourceField, validation: mapping.validation, value: transformedValue }, 'Dynamic validation failed');
            continue;
          }
        }

        setNestedValue(raw, mapping.targetField, transformedValue);
        applicableCount++;
      }
    }

    log.debug({ applicableCount, totalMappings: mappings.size }, 'Applied dynamic mappings');

    // Fallback: Asegurar que alias.value esté poblado
    if (!raw.alias || !(raw.alias as Record<string, unknown>).value) {
      const aliasValue = req.creditor.alias.startsWith('CLABE-')
        ? req.creditor.alias.slice(6)
        : req.creditor.alias;
      setNestedValue(raw, 'alias.value', aliasValue);
    }

    // Validar con Zod
    const result = canonicalPacs008Schema.safeParse(raw);
    if (!result.success) {
      log.error({ errors: result.error.flatten() }, 'SPEI → Canonical validation failed');
      throw new TranslationError('SPEI', 'Invalid canonical output from SPEI translation', {
        zodErrors: result.error.flatten().fieldErrors,
      });
    }

    log.info('SPEI → Canonical translation complete');
    return result.data;
  } catch (err) {
    if (err instanceof TranslationError) {
      throw err;
    }
    log.error({ err }, 'Unexpected error in speiToCanonical');
    throw new TranslationError('SPEI', 'Unexpected error during translation', { cause: err });
  }
}
