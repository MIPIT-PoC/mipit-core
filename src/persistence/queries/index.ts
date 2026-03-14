/**
 * SQL Query Constants
 * 
 * Todas las queries están definidas como constantes con nombres descriptivos
 * para mayor claridad y mantenibilidad. Cada constante corresponde a una
 * operación específica sobre las tablas de base de datos.
 * 
 * Convenciones de nombres:
 * - INSERT_* = Inserciones
 * - FIND_* = Búsquedas / SELECT
 * - UPDATE_* = Actualizaciones
 */

export const SQL = {
  // =====================================
  // PAYMENT Queries
  // =====================================

  /**
   * INSERT_PAYMENT
   * Inserta un nuevo pago en la tabla de pagos con todos sus datos iniciales.
   * 
   * Parámetros: ($1-$15)
   * 1. payment_id (ULID)
   * 2. idempotency_key (para deduplicación)
   * 3. status (estado inicial: RECEIVED)
   * 4. origin_rail (PIX o SPEI)
   * 5. amount (monto)
   * 6. currency (moneda: MXN)
   * 7. debtor_alias (identificador de pagador)
   * 8. debtor_name (nombre de pagador)
   * 9. creditor_alias (identificador de beneficiario)
   * 10. creditor_name (nombre de beneficiario)
   * 11. purpose (propósito / concepto)
   * 12. reference (referencia de pago)
   * 13. origin_payload (JSON original del request)
   * 14. trace_id (para trazabilidad distribuida)
   * 15. created_at (timestamp ISO)
   */
  INSERT_PAYMENT: `
    INSERT INTO payments (
      payment_id, idempotency_key, status, origin_rail,
      amount, currency, debtor_alias, debtor_name,
      creditor_alias, creditor_name, purpose, reference,
      origin_payload, trace_id, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *`,

  /**
   * FIND_PAYMENT_BY_ID
   * Obtiene un pago específico por su payment_id.
   * 
   * Parámetros: ($1)
   * 1. payment_id (ULID del pago)
   */
  FIND_PAYMENT_BY_ID: `
    SELECT * FROM payments WHERE payment_id = $1`,

  /**
   * UPDATE_PAYMENT_STATUS
   * Actualiza el estado de un pago y el timestamp de actualización.
   * 
   * Parámetros: ($1-$2)
   * 1. status (nuevo estado)
   * 2. payment_id (ULID del pago)
   */
  UPDATE_PAYMENT_STATUS: `
    UPDATE payments
    SET status = $1, updated_at = NOW()
    WHERE payment_id = $2
    RETURNING *`,

  /**
   * UPDATE_PAYMENT_STATUS_WITH_MILESTONE_TIMESTAMPS
   * Actualiza estado y los timestamps milestones correspondientes a cada estado.
   * Útil para obtener métricas de performance por etapa.
   * 
   * Parámetros: ($1-$2)
   * 1. status (nuevo estado)
   * 2. payment_id (ULID del pago)
   */
  UPDATE_PAYMENT_STATUS_WITH_MILESTONE_TIMESTAMPS: `
    UPDATE payments
    SET status = $1, updated_at = NOW(),
        validated_at = CASE WHEN $1 = 'VALIDATED' THEN NOW() ELSE validated_at END,
        queued_at = CASE WHEN $1 = 'QUEUED' THEN NOW() ELSE queued_at END,
        sent_at = CASE WHEN $1 = 'SENT_TO_DESTINATION' THEN NOW() ELSE sent_at END,
        completed_at = CASE WHEN $1 = 'COMPLETED' THEN NOW() ELSE completed_at END,
        failed_at = CASE WHEN $1 = 'FAILED' THEN NOW() ELSE failed_at END
    WHERE payment_id = $2
    RETURNING *`,

  /**
   * UPDATE_PAYMENT_CANONICAL_PAYLOAD
   * Actualiza el payload canonicalizado (PACS008) del pago.
   * 
   * Parámetros: ($1-$3)
   * 1. canonical_payload (JSON normalizado)
   * 2. status (nuevo estado: VALIDATED)
   * 3. payment_id (ULID del pago)
   */
  UPDATE_PAYMENT_CANONICAL_PAYLOAD: `
    UPDATE payments
    SET canonical_payload = $1, status = $2, canonicalized_at = NOW()
    WHERE payment_id = $3`,

  /**
   * UPDATE_PAYMENT_ROUTE
   * Actualiza la decisión de enrutamiento de un pago.
   * 
   * Parámetros: ($1-$4)
   * 1. destination_rail (rail destino: PIX, SPEI)
   * 2. route_rule_applied (nombre de la regla que matching)
   * 3. status (nuevo estado: ROUTED)
   * 4. payment_id (ULID del pago)
   */
  UPDATE_PAYMENT_ROUTE: `
    UPDATE payments
    SET destination_rail = $1, route_rule_applied = $2, status = $3, routed_at = NOW()
    WHERE payment_id = $4`,

  /**
   * UPDATE_PAYMENT_TRANSLATED_PAYLOAD
   * Actualiza el payload traducido al formato específico del rail destino.
   * 
   * Parámetros: ($1-$2)
   * 1. translated_payload (JSON en formato del adapter)
   * 2. payment_id (ULID del pago)
   */
  UPDATE_PAYMENT_TRANSLATED_PAYLOAD: `
    UPDATE payments SET translated_payload = $1 WHERE payment_id = $2`,

  /**
   * UPDATE_RAIL_ACK
   * Actualiza la respuesta de confirmación (ACK) recibido del rail.
   * Actualiza status a COMPLETED o FAILED según el ACK.
   * 
   * Parámetros: ($1-$3)
   * 1. rail_ack (JSON completo del ACK)
   * 2. status (estado final: COMPLETED o FAILED)
   * 3. payment_id (ULID del pago)
   */
  UPDATE_RAIL_ACK: `
    UPDATE payments
    SET rail_ack = $1::jsonb, status = $2, acked_at = NOW(), updated_at = NOW(),
        completed_at = CASE WHEN $2 = 'COMPLETED' THEN NOW() ELSE completed_at END
    WHERE payment_id = $3
    RETURNING *`,

  // =====================================
  // AUDIT_EVENTS Queries
  // =====================================

  /**
   * INSERT_AUDIT
   * Inserta un evento de auditoría con todos sus detalles.
   * Los eventos de auditoría son inmutables (append-only).
   * 
   * Parámetros: ($1-$7)
   * 1. id (ULID del evento)
   * 2. payment_id (ULID del pago asociado)
   * 3. event_type (tipo: STATUS_CHANGE, ROUTE_DECISION, etc.)
   * 4. actor (quién: system, adapter-pix, adapter-spei, etc.)
   * 5. detail (JSON con detalles del evento)
   * 6. trace_id (para trazabilidad distribuida)
   * 7. created_at (timestamp ISO)
   */
  INSERT_AUDIT: `
    INSERT INTO audit_events (id, payment_id, event_type, actor, detail, trace_id, created_at)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,

  /**
   * FIND_AUDITS_BY_PAYMENT
   * Obtiene todos los eventos de auditoría para un pago.
   * Ordenados cronológicamente (más antiguos primero).
   * 
   * Parámetros: ($1)
   * 1. payment_id (ULID del pago)
   */
  FIND_AUDITS_BY_PAYMENT: `
    SELECT * FROM audit_events WHERE payment_id = $1 ORDER BY created_at ASC`,

  // =====================================
  // IDEMPOTENCY_KEYS Queries
  // =====================================

  /**
   * FIND_IDEMPOTENCY_KEY
   * Busca una solicitud previa usando idempotency_key para evitar duplicados.
   * Solo retorna claves que no han expirado.
   * 
   * Parámetros: ($1)
   * 1. idempotency_key (clave de idempotencia del cliente)
   */
  FIND_IDEMPOTENCY_KEY: `
    SELECT * FROM idempotency_keys WHERE idempotency_key = $1 AND expires_at > NOW()`,

  /**
   * INSERT_IDEMPOTENCY
   * Guarda una nueva clave de idempotencia con el hash del request.
   * Permite detectar y rechazar solicitudes duplicadas.
   * 
   * Parámetros: ($1-$6)
   * 1. idempotency_key (clave de idempotencia proporcionada por cliente)
   * 2. payment_id (ULID del pago creado/procesado)
   * 3. request_hash (hash SHA256 del body del request)
   * 4. response_status (HTTP status code de la respuesta)
   * 5. response_body (JSON de la respuesta para retornar en duplicados)
   * 6. created_at (timestamp ISO)
   */
  INSERT_IDEMPOTENCY: `
    INSERT INTO idempotency_keys (idempotency_key, payment_id, request_hash, response_status, response_body, created_at)
    VALUES ($1,$2,$3,$4,$5,$6)`,

  /**
   * UPDATE_IDEMPOTENCY_RESPONSE
   * Actualiza la respuesta almacenada para una clave de idempotencia.
   * Usada cuando una solicitud previa se completa.
   * 
   * Parámetros: ($1-$3)
   * 1. response_status (HTTP status code)
   * 2. response_body (JSON de respuesta)
   * 3. idempotency_key (clave de idempotencia)
   */
  UPDATE_IDEMPOTENCY_RESPONSE: `
    UPDATE idempotency_keys SET response_status = $1, response_body = $2 WHERE idempotency_key = $3`,

  // =====================================
  // ROUTE_RULES Queries
  // =====================================

  /**
   * FIND_ACTIVE_RULES
   * Obtiene todas las reglas de enrutamiento activas.
   * Ordenadas por prioridad (menor número = mayor prioridad).
   * 
   * Sin parámetros
   */
  FIND_ACTIVE_RULES: `
    SELECT * FROM route_rules WHERE is_active = true ORDER BY priority ASC`,

  /**
   * FIND_ROUTE_RULE_BY_ID
   * Obtiene una regla de enrutamiento específica.
   * 
   * Parámetros: ($1)
   * 1. id (identificador de la regla)
   */
  FIND_ROUTE_RULE_BY_ID: `
    SELECT * FROM route_rules WHERE id = $1`,

  // =====================================
  // MAPPING_TABLE Queries
  // =====================================

  /**
   * FIND_MAPPINGS_BY_RAIL
   * Obtiene los mappings (traducciones de campos) para un rail específico.
   * 
   * Parámetros: ($1-$2)
   * 1. rail (PIX o SPEI)
   * 2. direction (INBOUND o OUTBOUND)
   */
  FIND_MAPPINGS_BY_RAIL: `
    SELECT * FROM mapping_table WHERE rail = $1 AND direction = $2 AND is_active = true ORDER BY source_field`,

  /**
   * FIND_ALL_MAPPINGS
   * Obtiene todos los mappings activos para referencia general.
   * 
   * Sin parámetros
   */
  FIND_ALL_MAPPINGS: `
    SELECT * FROM mapping_table WHERE is_active = true ORDER BY rail, direction, source_field`,
} as const;
