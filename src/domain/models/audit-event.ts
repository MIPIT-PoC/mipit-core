export interface AuditEvent {
  id: string;
  payment_id: string;
  event_type: string;
  stage: string;
  trace_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}
