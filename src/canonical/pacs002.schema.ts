import { z } from 'zod';

/**
 * ISO 20022 pacs.002.001.10 FIToFIPaymentStatusReport — derived (subset).
 *
 * Mandatory ISO fields modeled here:
 *   - GrpHdr.MsgId, GrpHdr.CreDtTm
 *   - OrgnlGrpInfAndSts.OrgnlMsgId, OrgnlMsgNmId
 *   - TxInfAndSts.OrgnlEndToEndId, OrgnlUETR, TxSts (ISO codes)
 *
 * MiPIT-specific extensions (not in ISO):
 *   - payment_id, rail_tx_id, raw_response, processed_at
 *
 * Status codes (TxSts) follow ISO ExternalPaymentTransactionStatus:
 *   ACSC = AcceptedSettlementCompleted (terminal success)
 *   ACSP = AcceptedSettlementInProcess (in-flight)
 *   RJCT = Rejected (terminal failure)
 *   PART = PartiallyAccepted
 *   PDNG = Pending (poll required)
 */
export const PACS002_TX_STATUS = ['ACSC', 'ACSP', 'RJCT', 'PART', 'PDNG'] as const;
export type Pacs002TxStatus = typeof PACS002_TX_STATUS[number];

/**
 * Mapping from legacy MiPIT adapter ack status to ISO TxSts.
 * Used in the consumer for backward compatibility.
 */
export function legacyStatusToTxSts(
  legacy: 'ACCEPTED' | 'REJECTED' | 'ERROR' | 'PENDING' | string,
): Pacs002TxStatus {
  switch (legacy) {
    case 'ACCEPTED':
      return 'ACSC';
    case 'REJECTED':
      return 'RJCT';
    case 'ERROR':
      return 'RJCT'; // ERROR is transport-level — map to RJCT with StsRsnInf.AddtlInf
    case 'PENDING':
      return 'PDNG';
    default:
      return 'RJCT';
  }
}

export const pacs002AckSchema = z.object({
  // ─── ISO 20022 fields (mandatory subset) ────────────────────────────────
  /** GrpHdr.MsgId — unique ID for this status report message. */
  msgId: z.string().max(35),
  /** GrpHdr.CreDtTm — when this status report was created. */
  creDtTm: z.string().datetime(),

  /** OrgnlGrpInfAndSts.OrgnlMsgId — original pacs.008 message ID. */
  orgnlMsgId: z.string().max(35),
  /** OrgnlGrpInfAndSts.OrgnlMsgNmId — ID of the schema of the original message. */
  orgnlMsgNmId: z.literal('pacs.008.001.10').or(z.literal('pacs.008.001.08')),
  /** OrgnlGrpInfAndSts.OrgnlCreDtTm — original message creation time. */
  orgnlCreDtTm: z.string().datetime().optional(),

  /** TxInfAndSts.OrgnlInstrId */
  orgnlInstrId: z.string().max(35).optional(),
  /** TxInfAndSts.OrgnlEndToEndId — preserved end-to-end ID. */
  orgnlEndToEndId: z.string().max(35),
  /** TxInfAndSts.OrgnlTxId */
  orgnlTxId: z.string().max(35).optional(),
  /** TxInfAndSts.OrgnlUETR — universal tracking key (UUIDv4). */
  orgnlUetr: z.string().uuid(),

  /** TxInfAndSts.TxSts — ISO ExternalPaymentTransactionStatus. */
  txSts: z.enum(PACS002_TX_STATUS),

  /** TxInfAndSts.StsRsnInf — status reason information (required on RJCT). */
  stsRsnInf: z
    .object({
      rsn: z.object({
        /** Cd from ExternalStatusReason1Code (AC01, AC04, AM04, FF01, MS03, etc.). */
        cd: z.string().max(4).optional(),
        /** Proprietary reason code (used when Cd is not in the ISO catalog). */
        prtry: z.string().max(35).optional(),
      }),
      /** AddtlInf — free-form additional information lines. */
      addtlInf: z.array(z.string().max(105)).max(10).optional(),
    })
    .optional(),

  // ─── MiPIT extensions (not in ISO) ──────────────────────────────────────
  /** MiPIT internal correlation: PMT-XXXX. */
  payment_id: z.string(),
  /** Rail's own transaction ID (e.g. PIX `txid`, SPEI `folioControl`, Bre-B `idConfirmacion`). */
  rail_tx_id: z.string().optional(),
  /** Raw rail response (for audit/debug). */
  raw_response: z.record(z.unknown()).optional(),
  /** When the adapter finished processing. */
  processed_at: z.string().datetime(),
});

export type Pacs002Ack = z.infer<typeof pacs002AckSchema>;
