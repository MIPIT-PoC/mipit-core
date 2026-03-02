import { z } from 'zod';

export const canonicalPacs008Schema = z.object({
  payment_id: z.string().regex(/^PMT-[A-Z0-9]{10,32}$/),
  created_at: z.string().datetime(),

  grpHdr: z.object({
    msgId: z.string(),
    creDtTm: z.string().datetime(),
  }),

  pmtId: z.object({
    endToEndId: z.string(),
  }),

  amount: z.object({
    value: z.number().positive(),
    currency: z.string().length(3),
  }),

  fx: z
    .object({
      source_currency: z.string().length(3).optional(),
      target_currency: z.string().length(3).optional(),
      rate: z.number().positive().optional(),
      local_amount: z.number().positive().optional(),
    })
    .optional(),

  origin: z.object({
    rail: z.enum(['PIX', 'SPEI']),
  }),

  destination: z.object({
    rail: z.enum(['PIX', 'SPEI']).optional(),
  }),

  debtor: z.object({
    name: z.string().max(140).optional(),
    country: z.string().length(2).optional(),
    account_id: z.string(),
  }),

  creditor: z.object({
    name: z.string().max(140).optional(),
    country: z.string().length(2).optional(),
    account_id: z.string(),
  }),

  alias: z.object({
    type: z.enum(['PIX_KEY', 'CLABE']),
    value: z.string(),
  }),

  purpose: z.string().max(35).default('P2P'),
  reference: z.string().max(140).default('MIPIT-POC'),
  status: z.string(),
  trace_id: z.string().optional(),

  rail_ack: z
    .object({
      rail_tx_id: z.string().optional(),
      status: z.enum(['ACCEPTED', 'REJECTED', 'ERROR']).optional(),
      error: z
        .object({
          code: z.string(),
          message: z.string(),
        })
        .optional(),
    })
    .optional()
    .nullable(),
});

export type CanonicalPacs008 = z.infer<typeof canonicalPacs008Schema>;
