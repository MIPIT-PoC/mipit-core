export const SQL = {
  // ─── Payments ────────────────────────────────────────
  INSERT_PAYMENT: `
    INSERT INTO payments (
      payment_id, idempotency_key, status, origin_rail,
      amount, currency, debtor_alias, debtor_name,
      creditor_alias, creditor_name, purpose, reference,
      origin_payload, trace_id, created_at,
      uetr, end_to_end_id, instr_id, tx_id,
      charge_bearer, interbank_settlement_date,
      instructed_amount, instructed_currency,
      settlement_amount, settlement_currency,
      exchange_rate, exchange_rate_source,
      origin_ispb, origin_institution_code, destination_institution_code
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
      $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30
    )
    RETURNING *`,

  FIND_PAYMENT_BY_ID: `SELECT * FROM payments WHERE payment_id = $1`,

  UPDATE_PAYMENT_STATUS_WITH_MILESTONE_TIMESTAMPS: `
    UPDATE payments SET
      status           = $1,
      validated_at     = CASE WHEN $1 = 'VALIDATED'           THEN NOW() ELSE validated_at END,
      queued_at        = CASE WHEN $1 = 'QUEUED'              THEN NOW() ELSE queued_at END,
      sent_at          = CASE WHEN $1 = 'SENT_TO_DESTINATION' THEN NOW() ELSE sent_at END,
      completed_at     = CASE WHEN $1 = 'COMPLETED'           THEN NOW() ELSE completed_at END,
      failed_at        = CASE WHEN $1 = 'FAILED'              THEN NOW() ELSE failed_at END,
      compensated_at   = CASE WHEN $1 = 'COMPENSATED'         THEN NOW() ELSE compensated_at END,
      dead_letter_at   = CASE WHEN $1 = 'DEAD_LETTER'         THEN NOW() ELSE dead_letter_at END
    WHERE payment_id = $2
    RETURNING *`,

  UPDATE_PAYMENT_CANONICAL_PAYLOAD: `
    UPDATE payments
    SET canonical_payload = $1::jsonb, status = $2, canonicalized_at = NOW()
    WHERE payment_id = $3
    RETURNING *`,

  UPDATE_PAYMENT_ROUTE: `
    UPDATE payments
    SET destination_rail = $1, route_rule_applied = $2, status = $3, routed_at = NOW(),
        destination_institution_code = COALESCE($5, destination_institution_code)
    WHERE payment_id = $4
    RETURNING *`,

  UPDATE_PAYMENT_TRANSLATED_PAYLOAD: `
    UPDATE payments
    SET translated_payload = $1::jsonb
    WHERE payment_id = $2
    RETURNING *`,

  /** Persist FX results on the payment row (P05/P01). */
  UPDATE_PAYMENT_FX_AND_SETTLEMENT: `
    UPDATE payments
    SET instructed_amount    = $1,
        instructed_currency  = $2,
        settlement_amount    = $3,
        settlement_currency  = $4,
        exchange_rate        = $5,
        exchange_rate_source = $6
    WHERE payment_id = $7
    RETURNING *`,

  UPDATE_RAIL_ACK: `
    UPDATE payments
    SET rail_ack = $1::jsonb, status = $2, acked_at = NOW(),
        completed_at = CASE WHEN $2 = 'COMPLETED' THEN NOW() ELSE completed_at END
    WHERE payment_id = $3
    RETURNING *`,

  // ─── Audit ───────────────────────────────────────────
  INSERT_AUDIT: `
    INSERT INTO audit_events (id, payment_id, event_type, actor, detail, trace_id, created_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,

  FIND_AUDITS_BY_PAYMENT: `
    SELECT * FROM audit_events WHERE payment_id = $1 ORDER BY created_at ASC`,

  // ─── Idempotency ─────────────────────────────────────
  FIND_IDEMPOTENCY_BY_KEY: `
    SELECT * FROM idempotency_keys WHERE idempotency_key = $1 AND expires_at > NOW()`,

  /**
   * Insert with explicit expires_at (P06 fix for TTL bug).
   * The legacy INSERT_IDEMPOTENCY relied on DB DEFAULT (NOW() + 24h) which only
   * works if the column has the default — fragile. Now caller supplies expires_at.
   */
  INSERT_IDEMPOTENCY: `
    INSERT INTO idempotency_keys (idempotency_key, payment_id, request_hash, response_status, response_body, created_at, expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING payment_id`,

  UPDATE_IDEMPOTENCY_RESPONSE: `
    UPDATE idempotency_keys SET response_status = $1, response_body = $2 WHERE idempotency_key = $3`,

  /** Sweeper for expired idempotency claims (P09 introduced the function). */
  SWEEP_IDEMPOTENCY_EXPIRED: `SELECT sweep_expired_idempotency_keys() AS deleted`,

  // ─── Route Rules ─────────────────────────────────────
  /**
   * ORDER BY (priority, id) for stable tie-breaking when two rules share a priority.
   */
  FIND_ACTIVE_ROUTE_RULES: `
    SELECT * FROM route_rules WHERE is_active = true ORDER BY priority ASC, id ASC`,

  FIND_ROUTE_RULE_BY_ID: `SELECT * FROM route_rules WHERE id = $1`,

  // ─── Mapping Table ───────────────────────────────────
  FIND_MAPPINGS_BY_RAIL: `
    SELECT * FROM mapping_table WHERE rail = $1 AND direction = $2 AND is_active = true ORDER BY source_field`,

  FIND_ALL_MAPPINGS: `
    SELECT * FROM mapping_table WHERE is_active = true ORDER BY rail, direction, source_field`,
} as const;
