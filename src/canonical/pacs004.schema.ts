/**
 * ISO 20022 pacs.004.001.09 — Payment Return (CBPR+ compatible subset).
 *
 * W6.4 — Used by the compensation service to emit a proper reversal message
 * when a payment is compensated. Previously the service only mutated the DB
 * status (COMPENSATED) which made the "saga compensation" claim impossible to
 * demonstrate end-to-end.
 *
 * Minimal subset implemented:
 *   - GrpHdr: MsgId, CreDtTm, NbOfTxs, TtlRtrdIntrBkSttlmAmt, SttlmInf
 *   - OrgnlGrpInf: OrgnlMsgId, OrgnlMsgNmId, OrgnlCreDtTm
 *   - TxInf:
 *       OrgnlEndToEndId, OrgnlTxId, OrgnlUETR
 *       RtrId
 *       RtrdIntrBkSttlmAmt (currency + value)
 *       RtrRsnInf.Rsn.Cd (ISO ExternalReturnReason1Code) + Rsn.Prtry
 *       RtrRsnInf.AddtlInf
 *
 * Not implemented (scope-out, LIMITATIONS.md §2 amendment):
 *   - Multiple TxInf per message (always NbOfTxs=1, single TxInf)
 *   - ChrgsInf, IntrmyAgt, UltmtDbtr/UltmtCdtr
 */

import { z } from 'zod';

/**
 * ExternalReturnReason1Code — abbreviated catalogue for the codes most
 * commonly emitted by MIPIT compensations.
 *   AC04 = ClosedAccount (the destination account was closed)
 *   AM05 = Duplication
 *   FRAD = Fraudulent
 *   MS03 = NotSpecifiedReasonAgentGenerated
 *   NARR = Narrative (free-text in AddtlInf when no code applies)
 *   CUST = RequestedByCustomer
 *   TECH = TechnicalProblem (canceled by middleware/operator)
 */
export const RETURN_REASON_CODES = ['AC04', 'AM05', 'FRAD', 'MS03', 'NARR', 'CUST', 'TECH'] as const;
export type ReturnReasonCode = (typeof RETURN_REASON_CODES)[number];

export const pacs004ReturnSchema = z.object({
  msgId: z.string().max(35),
  creDtTm: z.string().datetime(),

  nbOfTxs: z.literal(1),
  ttlRtrdIntrBkSttlmAmt: z
    .object({
      value: z.number().nonnegative(),
      currency: z.string().length(3),
    })
    .optional(),

  /** Settlement method — defaults to 'CLRG' (clearing system) for instant rails. */
  sttlmInf: z
    .object({
      sttlmMtd: z.enum(['INDA', 'INGA', 'COVE', 'CLRG']).default('CLRG'),
    })
    .optional(),

  /** Reference to the original pacs.008 message group. */
  orgnlGrpInf: z.object({
    orgnlMsgId: z.string().max(35),
    orgnlMsgNmId: z.string().regex(/^pacs\.008\.001\.\d{2}$/),
    orgnlCreDtTm: z.string().datetime().optional(),
  }),

  /** The single transaction being returned. */
  txInf: z.object({
    rtrId: z.string().max(35),
    orgnlInstrId: z.string().max(35).optional(),
    orgnlEndToEndId: z.string().max(35),
    orgnlTxId: z.string().max(35).optional(),
    orgnlUetr: z.string().uuid().optional(),

    /** Amount being returned (usually the full original IntrBkSttlmAmt). */
    rtrdIntrBkSttlmAmt: z.object({
      value: z.number().nonnegative(),
      currency: z.string().length(3),
    }),

    rtrRsnInf: z.object({
      rsn: z.object({
        cd: z.enum(RETURN_REASON_CODES).optional(),
        prtry: z.string().max(35).optional(),
      }),
      addtlInf: z.array(z.string().max(105)).max(2).optional(),
    }),
  }),
});

export type Pacs004Return = z.infer<typeof pacs004ReturnSchema>;
