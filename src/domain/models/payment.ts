import type { PaymentStatus } from '../../config/constants.js';
import type { Rail } from '../../config/constants.js';

export interface PaymentIntent {
  payment_id: string;
  idempotency_key?: string;
  status: PaymentStatus;
  origin_rail: Rail | string;
  destination_rail?: Rail | string;
  amount: number;
  currency: string;
  debtor_alias: string;
  debtor_name?: string;
  creditor_alias: string;
  creditor_name?: string;
  purpose?: string;
  reference?: string;
  origin_payload: unknown;
  canonical_payload?: unknown;
  translated_payload?: unknown;
  rail_ack?: unknown;
  route_rule_applied?: string;
  trace_id?: string;
  created_at: string;
  validated_at?: string;
  canonicalized_at?: string;
  routed_at?: string;
  queued_at?: string;
  sent_at?: string;
  acked_at?: string;
  completed_at?: string;
}
