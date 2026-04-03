import { ulid } from 'ulid';
import { canonicalPacs008Schema, type CanonicalPacs008 } from '../domain/models/canonical.js';
import { TranslationError } from '../domain/errors/index.js';
import { logger } from '../observability/logger.js';

/**
 * ISO 20022 MX pacs.008.001.08 structured representation.
 * This is the modern replacement for SWIFT MT103, used by:
 *   - SWIFT MX (ISO 20022 migration)
 *   - FedNow (as JSON)
 *   - SEPA CT (as XML)
 *   - Many central bank RTGS systems
 *
 * Reference: ISO 20022 FIToFICustomerCreditTransfer (pacs.008.001.08)
 */
export interface Iso20022Pacs008 {
  /** Group Header */
  GrpHdr: {
    MsgId: string;
    CreDtTm: string;
    NbOfTxs: string;
    SttlmInf: {
      SttlmMtd: 'INDA' | 'INGA' | 'COVE' | 'CLRG';
    };
    InstgAgt?: { FinInstnId: { BICFI?: string; ClrSysMmbId?: { MmbId: string } } };
    InstdAgt?: { FinInstnId: { BICFI?: string; ClrSysMmbId?: { MmbId: string } } };
  };

  /** Credit Transfer Transaction Information */
  CdtTrfTxInf: {
    /** Payment Identification */
    PmtId: {
      InstrId?: string;
      EndToEndId: string;
      TxId?: string;
    };

    /** Interbank Settlement Amount */
    IntrBkSttlmAmt: {
      Ccy: string;
      value: string; // String to preserve precision
    };

    /** Instructed Amount (before FX) */
    InstdAmt?: {
      Ccy: string;
      value: string;
    };

    /** Interbank Settlement Date */
    IntrBkSttlmDt?: string;

    /** Exchange Rate Information */
    XchgRate?: string;

    /** Debtor Agent */
    DbtrAgt?: {
      FinInstnId: {
        BICFI?: string;
        ClrSysMmbId?: { ClrSysId?: { Cd: string }; MmbId: string };
      };
    };

    /** Debtor */
    Dbtr: {
      Nm?: string;
      PstlAdr?: {
        Ctry?: string;
        AdrLine?: string[];
      };
      Id?: {
        PrvtId?: { Othr: { Id: string } };
        OrgId?: { Othr: { Id: string } };
      };
    };

    /** Debtor Account */
    DbtrAcct: {
      Id: {
        IBAN?: string;
        Othr?: { Id: string; SchmeNm?: { Cd?: string; Prtry?: string } };
      };
    };

    /** Creditor Agent */
    CdtrAgt?: {
      FinInstnId: {
        BICFI?: string;
        ClrSysMmbId?: { ClrSysId?: { Cd: string }; MmbId: string };
      };
    };

    /** Creditor */
    Cdtr: {
      Nm?: string;
      PstlAdr?: {
        Ctry?: string;
        AdrLine?: string[];
      };
      Id?: {
        PrvtId?: { Othr: { Id: string } };
        OrgId?: { Othr: { Id: string } };
      };
    };

    /** Creditor Account */
    CdtrAcct: {
      Id: {
        IBAN?: string;
        Othr?: { Id: string; SchmeNm?: { Cd?: string; Prtry?: string } };
      };
    };

    /** Purpose */
    Purp?: { Cd?: string; Prtry?: string };

    /** Remittance Information */
    RmtInf?: {
      Ustrd?: string;
      Strd?: Array<{
        CdtrRefInf?: { Ref: string };
      }>;
    };
  };
}

/**
 * Translates an ISO 20022 pacs.008 MX message to the canonical model.
 */
export async function iso20022MxToCanonical(
  payload: Iso20022Pacs008 | Record<string, unknown>,
  paymentId: string,
  traceId?: string,
): Promise<CanonicalPacs008> {
  const log = logger.child({ payment_id: paymentId, rail: 'ISO20022_MX' });

  try {
    // Handle both direct object and wrapped {Document: {FIToFICstmrCdtTrf: ...}} formats
    const doc = (payload as Record<string, unknown>).Document as Record<string, unknown> | undefined;
    const cdtTrf = doc?.FIToFICstmrCdtTrf as Iso20022Pacs008 | undefined;
    const msg = cdtTrf ?? (payload as Iso20022Pacs008);

    const grp = msg.GrpHdr;
    const txn = msg.CdtTrfTxInf;

    const now = new Date().toISOString();
    const settlementAmount = parseFloat(txn.IntrBkSttlmAmt.value);
    const currency = txn.IntrBkSttlmAmt.Ccy.toUpperCase();

    // Extract debtor account
    const debtorIban = txn.DbtrAcct.Id.IBAN;
    const debtorOthr = txn.DbtrAcct.Id.Othr?.Id;
    const debtorAccountId = debtorIban ?? debtorOthr ?? 'UNKNOWN';

    // Extract creditor account
    const creditorIban = txn.CdtrAcct.Id.IBAN;
    const creditorOthr = txn.CdtrAcct.Id.Othr?.Id;
    const creditorAccountId = creditorIban ?? creditorOthr ?? 'UNKNOWN';

    // Routing numbers for ACH / FedNow
    const dbtrRoutingNum = txn.DbtrAgt?.FinInstnId.ClrSysMmbId?.MmbId;
    const cdtrRoutingNum = txn.CdtrAgt?.FinInstnId.ClrSysMmbId?.MmbId;

    // FX info
    const fx = txn.XchgRate
      ? {
          rate: parseFloat(txn.XchgRate),
          source_currency: txn.InstdAmt?.Ccy ?? currency,
          local_amount: txn.InstdAmt ? parseFloat(txn.InstdAmt.value) : undefined,
        }
      : undefined;

    // Remittance
    const remittance = txn.RmtInf?.Ustrd
      ?? txn.RmtInf?.Strd?.[0]?.CdtrRefInf?.Ref
      ?? undefined;

    // Purpose
    const purpose = txn.Purp?.Cd ?? txn.Purp?.Prtry ?? 'P2P';

    const raw = {
      payment_id: paymentId,
      created_at: now,
      grpHdr: {
        msgId: grp.MsgId ?? `MSG-${ulid()}`,
        creDtTm: grp.CreDtTm ?? now,
        nbOfTxs: parseInt(grp.NbOfTxs ?? '1', 10),
        sttlmInf: { sttlmMtd: grp.SttlmInf?.SttlmMtd ?? 'CLRG' },
      },
      pmtId: {
        endToEndId: txn.PmtId.EndToEndId.substring(0, 35),
        instrId: txn.PmtId.InstrId?.substring(0, 35),
        txId: txn.PmtId.TxId?.substring(0, 35),
      },
      amount: {
        value: settlementAmount,
        currency,
        instdAmt: txn.InstdAmt ? parseFloat(txn.InstdAmt.value) : undefined,
        instdAmtCcy: txn.InstdAmt?.Ccy?.toUpperCase(),
      },
      fx,
      origin: {
        rail: 'ISO20022_MX' as const,
        bic: txn.DbtrAgt?.FinInstnId.BICFI,
        routingNumber: dbtrRoutingNum,
      },
      destination: {
        rail: undefined,
        bic: txn.CdtrAgt?.FinInstnId.BICFI,
        routingNumber: cdtrRoutingNum,
      },
      debtor: {
        name: txn.Dbtr.Nm?.substring(0, 140),
        country: txn.Dbtr.PstlAdr?.Ctry,
        account_id: debtorAccountId,
        address: txn.Dbtr.PstlAdr?.AdrLine?.slice(0, 4),
      },
      creditor: {
        name: txn.Cdtr.Nm?.substring(0, 140),
        country: txn.Cdtr.PstlAdr?.Ctry,
        account_id: creditorAccountId,
        address: txn.Cdtr.PstlAdr?.AdrLine?.slice(0, 4),
      },
      alias: {
        type: (creditorIban ? 'IBAN' : 'ACCOUNT') as const,
        value: creditorAccountId,
      },
      purpose: purpose.substring(0, 35),
      reference: txn.PmtId.EndToEndId,
      remittanceInfo: remittance?.substring(0, 140),
      status: 'RECEIVED',
      trace_id: traceId,
    };

    const result = canonicalPacs008Schema.safeParse(raw);
    if (!result.success) {
      log.error({ errors: result.error.flatten() }, 'ISO20022 MX → Canonical validation failed');
      throw new TranslationError('ISO20022_MX', 'Invalid canonical output from ISO 20022 translation', {
        zodErrors: result.error.flatten().fieldErrors,
      });
    }

    log.info('ISO 20022 MX → Canonical translation complete');
    return result.data;
  } catch (err) {
    if (err instanceof TranslationError) throw err;
    log.error({ err }, 'Unexpected error in iso20022MxToCanonical');
    throw new TranslationError('ISO20022_MX', 'Unexpected error during ISO 20022 translation', { cause: err });
  }
}
