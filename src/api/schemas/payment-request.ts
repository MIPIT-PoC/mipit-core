import { z } from 'zod';
import { CHARGE_BEARER_ENUM } from '../../domain/models/canonical.js';

/** Validates a CLABE number (18 digits + correct check digit) */
function isValidCLABE(clabe: string): boolean {
  if (!/^\d{18}$/.test(clabe)) return false;
  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7];
  const sum = weights.reduce((acc, w, i) => acc + (parseInt(clabe[i], 10) * w), 0);
  return parseInt(clabe[17], 10) === (10 - (sum % 10)) % 10;
}

/**
 * Validates a Colombia mobile phone key per BanRep TR-002 (mobile-only): +57
 * followed by `3` and exactly 9 more digits. W5.11 — previously accepted
 * landlines `+571xxx`, which the Bre-B mock then rejected, causing a 400
 * after the core had already inferred BRE_B.
 */
function isValidColombiaPhone(phone: string): boolean {
  return /^\+573\d{9}$/.test(phone);
}

/** Validates a Colombia NIT key: 9-10 digits, dash, 1 digit */
function isValidColombiaId(id: string): boolean {
  return /^\d{9,10}-\d$/.test(id);
}

/** Validates a BREB alias key (phone, NIT, email, alias, CC, CE, passport) */
function isValidBrebKey(key: string): boolean {
  if (key.startsWith('+57')) return isValidColombiaPhone(key);
  if (/^\d/.test(key) && key.includes('-')) return isValidColombiaId(key);
  if (key.includes('@')) return key.includes('.') && key.length >= 5;
  // Generic alias / CC / CE / passport: at least 3 chars
  return key.length >= 3;
}

function validateAlias(alias: string, field: 'debtor' | 'creditor'): true | string {
  if (!alias) return `${field} alias is required`;
  if (alias.startsWith('PIX-')) return alias.length > 4 ? true : `${field} PIX alias must have a key after the prefix`;
  if (alias.startsWith('SPEI-')) {
    const clabe = alias.slice(5);
    if (!isValidCLABE(clabe)) return `${field} SPEI alias must be a valid 18-digit CLABE (SPEI-XXXXXXXXXXXXXXXXXX)`;
    return true;
  }
  if (alias.startsWith('BREB-')) {
    const key = alias.slice(5);
    if (!isValidBrebKey(key)) return `${field} BREB alias must be a valid Colombia phone (+57XXXXXXXXXX), NIT, or email`;
    return true;
  }
  return `${field} alias must start with PIX-, SPEI-, or BREB-`;
}

export const createPaymentSchema = z.object({
  amount: z.number().positive('Amount must be greater than 0'),
  currency: z.string().length(3).default('USD'),
  debtor: z.object({
    alias: z.string().min(1).refine(
      (a) => validateAlias(a, 'debtor') === true,
      (a) => ({ message: String(validateAlias(a, 'debtor')) }),
    ),
    name: z.string().max(140).optional(),
  }),
  creditor: z.object({
    alias: z.string().min(1).refine(
      (a) => validateAlias(a, 'creditor') === true,
      (a) => ({ message: String(validateAlias(a, 'creditor')) }),
    ),
    name: z.string().max(140).optional(),
  }),
  purpose: z.string().max(35).optional().default('P2P'),
  reference: z.string().max(140).optional().default('MIPIT-POC'),
  /**
   * ISO 20022 ChrgBr (Charge Bearer). Per pacs.008.001.10 [1..1] mandatory.
   * For instant payment rails (PIX, SPEI, Bre-B) the default is SLEV
   * (service-level — charges per SLA, no separate negotiation).
   */
  chargeBearer: z.enum(CHARGE_BEARER_ENUM).optional().default('SLEV'),
});

export type CreatePaymentRequest = z.infer<typeof createPaymentSchema>;
