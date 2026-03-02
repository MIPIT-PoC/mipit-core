import { z } from 'zod';

export const pacs002AckSchema = z.object({
  payment_id: z.string(),
  rail_tx_id: z.string().optional(),
  status: z.enum(['ACCEPTED', 'REJECTED', 'ERROR']),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
  raw_response: z.record(z.unknown()).optional(),
  processed_at: z.string().datetime(),
});

export type Pacs002Ack = z.infer<typeof pacs002AckSchema>;
