import { z } from 'zod';

export const paymentAcceptedSchema = z.object({
  payment_id: z.string(),
  status: z.string(),
  received_at: z.string().datetime(),
  destination: z.string(),
});

export type PaymentAccepted = z.infer<typeof paymentAcceptedSchema>;

export const paymentDetailSchema = z.object({
  payment_id: z.string(),
  status: z.string(),
  origin: z.string(),
  destination: z.string().nullable(),
  amount: z.number(),
  currency: z.string(),
  original: z.unknown(),
  canonical: z.unknown().nullable(),
  translated: z.unknown().nullable(),
  rail_ack: z.unknown().nullable(),
  timestamps: z.object({
    created_at: z.string().datetime(),
    validated_at: z.string().datetime().nullable(),
    canonicalized_at: z.string().datetime().nullable(),
    routed_at: z.string().datetime().nullable(),
    queued_at: z.string().datetime().nullable(),
    sent_at: z.string().datetime().nullable(),
    acked_at: z.string().datetime().nullable(),
    completed_at: z.string().datetime().nullable(),
  }),
});

export type PaymentDetail = z.infer<typeof paymentDetailSchema>;
