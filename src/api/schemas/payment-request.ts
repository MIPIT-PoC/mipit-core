import { z } from 'zod';

/** Validates a CLABE number (18 digits + correct check digit) */
function isValidCLABE(clabe: string): boolean {
  if (!/^\d{18}$/.test(clabe)) return false;
  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7];
  const sum = weights.reduce((acc, w, i) => acc + (parseInt(clabe[i], 10) * w), 0);
  return parseInt(clabe[17], 10) === (10 - (sum % 10)) % 10;
}

/** Validates a Colombia phone key: +57 followed by exactly 10 digits */
function isValidColombiaPhone(phone: string): boolean {
  return /^\+57\d{10}$/.test(phone);
}

/** Validates a Colombia NIT key: 9-10 digits, dash, 1 digit */
function isValidColombiaId(id: string): boolean {
  return /^\d{9,10}-\d$/.test(id);
}

/** Validates a BREB alias key (phone, NIT, email, or alias) */
function isValidBrebKey(key: string): boolean {
  if (key.startsWith('+57')) return isValidColombiaPhone(key);
  if (/^\d/.test(key) && key.includes('-')) return isValidColombiaId(key);
  if (key.includes('@')) return key.includes('.') && key.length >= 5;
  // Generic alias: at least 3 chars
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
});

export type CreatePaymentRequest = z.infer<typeof createPaymentSchema>;
