import { z } from 'zod';

export const createPaymentSchema = z.object({
  amount: z.number().positive('Amount must be greater than 0'),
  currency: z.string().length(3).default('USD'),
  debtor: z.object({
    alias: z.string().min(1, 'Debtor alias is required'),
    name: z.string().max(140).optional(),
  }),
  creditor: z.object({
    alias: z.string().min(1, 'Creditor alias is required'),
    name: z.string().max(140).optional(),
  }),
  purpose: z.string().max(35).optional().default('P2P'),
  reference: z.string().max(140).optional().default('MIPIT-POC'),
});

export type CreatePaymentRequest = z.infer<typeof createPaymentSchema>;
