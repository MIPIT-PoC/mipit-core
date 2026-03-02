export const PAYMENT_STATUS = {
  RECEIVED: 'RECEIVED',
  VALIDATED: 'VALIDATED',
  CANONICALIZED: 'CANONICALIZED',
  ROUTED: 'ROUTED',
  QUEUED: 'QUEUED',
  SENT_TO_DESTINATION: 'SENT_TO_DESTINATION',
  ACKED_BY_RAIL: 'ACKED_BY_RAIL',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REJECTED: 'REJECTED',
  DUPLICATE: 'DUPLICATE',
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const RAILS = { PIX: 'PIX', SPEI: 'SPEI' } as const;
export type Rail = (typeof RAILS)[keyof typeof RAILS];

export const EXCHANGES = { PAYMENTS: 'mipit.payments' } as const;
export const ROUTING_KEYS = {
  ROUTE_PIX: 'route.pix',
  ROUTE_SPEI: 'route.spei',
  ACK_PIX: 'ack.pix',
  ACK_SPEI: 'ack.spei',
} as const;
export const QUEUES = { ACK: 'payments.ack' } as const;
