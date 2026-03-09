export const SQL = {
  // Payments
  INSERT_PAYMENT: `
    INSERT INTO payments (
      payment_id, idempotency_key, status, origin_rail,
      amount, currency, debtor_alias, debtor_name,
      creditor_alias, creditor_name, purpose, reference,
      origin_payload, trace_id, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *`,

  FIND_PAYMENT_BY_ID: `SELECT * FROM payments WHERE payment_id = $1`,

  UPDATE_PAYMENT_STATUS: `UPDATE payments SET status = $1 WHERE payment_id = $2`,

  UPDATE_CANONICAL: `
    UPDATE payments
    SET canonical_payload = $1, status = $2, canonicalized_at = NOW()
    WHERE payment_id = $3`,

  UPDATE_ROUTE: `
    UPDATE payments
    SET destination_rail = $1, route_rule_applied = $2, status = $3, routed_at = NOW()
    WHERE payment_id = $4`,

  UPDATE_TRANSLATED: `
    UPDATE payments SET translated_payload = $1 WHERE payment_id = $2`,

  UPDATE_ACK: `
    UPDATE payments
    SET rail_ack = $1, status = $2, acked_at = NOW(),
        completed_at = CASE WHEN $2 = 'COMPLETED' THEN NOW() ELSE completed_at END
    WHERE payment_id = $3`,

  // Audit
  INSERT_AUDIT_EVENT: `
    INSERT INTO audit_events (id, payment_id, event_type, stage, trace_id, metadata, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`,

  FIND_AUDIT_BY_PAYMENT_ID: `
    SELECT * FROM audit_events WHERE payment_id = $1 ORDER BY created_at ASC`,

  // Idempotency
  FIND_IDEMPOTENCY_BY_KEY: `SELECT * FROM idempotency_keys WHERE idempotency_key = $1 AND expires_at > NOW()`,

  INSERT_IDEMPOTENCY: `
    INSERT INTO idempotency_keys (idempotency_key, payment_id, request_hash, response_status, response_body, created_at)
    VALUES ($1,$2,$3,$4,$5,$6)`,

  UPDATE_IDEMPOTENCY_RESPONSE: `
    UPDATE idempotency_keys SET response_status = $1, response_body = $2 WHERE idempotency_key = $3`,

  // Route Rules
  FIND_ACTIVE_ROUTE_RULES: `SELECT * FROM route_rules WHERE is_active = true ORDER BY priority ASC`,

  FIND_ROUTE_RULE_BY_ID: `SELECT * FROM route_rules WHERE id = $1`,

  // Mapping Table
  FIND_MAPPINGS_BY_RAIL: `
    SELECT * FROM mapping_table WHERE rail = $1 AND direction = $2 AND is_active = true ORDER BY source_field`,

  FIND_ALL_MAPPINGS: `SELECT * FROM mapping_table WHERE is_active = true ORDER BY rail, direction, source_field`,
} as const;
