/**
 * Audit Event - Registra eventos importantes en el procesamiento de pagos
 * Usado para trazabilidad, debugging y cumplimiento normativo
 */
export interface AuditEvent {
  id: string; // ULID auto-generado
  payment_id: string; // ID del pago asociado
  event_type: string; // Tipo de evento (STATUS_CHANGE, VALIDATION_ERROR, ROUTING_DECISION, etc.)
  actor: string; // Actor que causó el evento (system, user, adapter-pix, adapter-spei)
  detail: Record<string, unknown>; // Detalles del evento como JSONB
  trace_id?: string; // ID de traza para correlación
  created_at: string; // Timestamp ISO cuando ocurrió
}

/**
 * Supported event types
 */
export const AUDIT_EVENT_TYPES = {
  STATUS_CHANGE: 'STATUS_CHANGE',
  CANONICAL_UPDATED: 'CANONICAL_UPDATED',
  ROUTE_DECISION: 'ROUTE_DECISION',
  TRANSLATION_COMPLETE: 'TRANSLATION_COMPLETE',
  ACK_RECEIVED: 'ACK_RECEIVED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  ROUTING_ERROR: 'ROUTING_ERROR',
  TRANSMISSION_ERROR: 'TRANSMISSION_ERROR',
  RETRY_INITIATED: 'RETRY_INITIATED',
  PAYMENT_DUPLICATED: 'PAYMENT_DUPLICATED',
} as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[keyof typeof AUDIT_EVENT_TYPES];

/**
 * Supported actors
 */
export const AUDIT_ACTORS = {
  SYSTEM: 'system',
  SYSTEM_VALIDATOR: 'system-validator',
  SYSTEM_ROUTER: 'system-router',
  SYSTEM_TRANSLATOR: 'system-translator',
  ADAPTER_PIX: 'adapter-pix',
  ADAPTER_SPEI: 'adapter-spei',
  USER: 'user',
} as const;

export type AuditActor = (typeof AUDIT_ACTORS)[keyof typeof AUDIT_ACTORS];
