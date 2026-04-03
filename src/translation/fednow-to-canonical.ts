import { ulid } from 'ulid';
import { canonicalPacs008Schema, type CanonicalPacs008 } from '../domain/models/canonical.js';
import { TranslationError } from '../domain/errors/index.js';
import { logger } from '../observability/logger.js';

/**
 * FedNow Service Payment Message
 * Operated by the Federal Reserve Bank of the United States.
 * FedNow uses ISO 20022 JSON format (pacs.008.001.08 in JSON encoding).
 * Launched: July 20, 2023.
 *
 * Key differences from standard ISO 20022 MX:
 *   - Uses JSON (not XML)
 *   - FedNow-specific clearing system codes
 *   - RoutingTransitNumber (RTN) for US bank identification
 *   - Transaction limits: $500,000 per transaction (default), up to $1M
 *   - Settlement: near-real-time (< 10 seconds)
 *
 * Reference: Federal Reserve FedNow API Specification v2024.1
 */
export interface FedNowPaymentMessage {
  /** Business Message Header (ISO 20022 BAH) */
  BusinessMessageHeader?: {
    Fr: { FIId: { FinInstnId: { BICFI?: string; ClrSysMmbId?: { MmbId: string } } } };
    To: { FIId: { FinInstnId: { BICFI?: string; ClrSysMmbId?: { MmbId: string } } } };
    BizMsgIdr: string;  // Business Message Identifier (max 35 chars)
    MsgDefIdr: 'pacs.008.001.08';
    BizSvc: 'fednow';   // FedNow service identifier
    CreDt: string;       // ISO 8601 datetime
  };

  /** FIToFI Customer Credit Transfer (pacs.008 core) */
  FIToFICstmrCdtTrf: {
    GrpHdr: {
      MsgId: string;       // Max 35 chars, unique per message
      CreDtTm: string;     // ISO 8601: YYYY-MM-DDTHH:MM:SS.sssZ
      NbOfTxs: string;     // Always "1" for FedNow
      SttlmInf: {
        SttlmMtd: 'CLRG';  // Always CLRG for FedNow
        ClrSys: {
          Cd: 'USABA';      // US ABA routing system
        };
      };
    };

    CdtTrfTxInf: {
      PmtId: {
        EndToEndId: string;  // Max 35 chars, provided by originator
        TxId?: string;       // Fed assigned transaction ID
        UETR?: string;       // Unique End-to-End Transaction Reference (UUID v4)
      };

      IntrBkSttlmAmt: {
        Ccy: 'USD';          // FedNow only supports USD
        value: string;       // Decimal string: "1234.56"
      };

      IntrBkSttlmDt: string; // YYYY-MM-DD

      /**
       * Debtor Agent — sending bank
       * Identified by ABA routing transit number (RTN)
       */
      DbtrAgt: {
        FinInstnId: {
          ClrSysMmbId: {
            ClrSysId: { Cd: 'USABA' };
            MmbId: string;  // 9-digit ABA RTN
          };
        };
      };

      /** Debtor — sender of funds */
      Dbtr: {
        Nm?: string;  // Max 140 chars
        PstlAdr?: {
          Ctry?: string;   // ISO 3166-1 alpha-2 (always 'US' for FedNow domestic)
          AdrLine?: string[];
        };
        Id?: {
          PrvtId?: { Othr: { Id: string } };   // SSN (not transmitted in practice)
          OrgId?: { Othr: { Id: string } };    // EIN
        };
      };

      /** Debtor Account */
      DbtrAcct: {
        Id: {
          Othr: {
            Id: string;          // Account number
            SchmeNm?: { Cd: 'BBAN' };
          };
        };
        Tp?: { Cd: 'CACC' | 'SVGS' };
      };

      /**
       * Creditor Agent — receiving bank
       * Identified by ABA routing transit number
       */
      CdtrAgt: {
        FinInstnId: {
          ClrSysMmbId: {
            ClrSysId: { Cd: 'USABA' };
            MmbId: string;  // 9-digit ABA RTN of receiving bank
          };
        };
      };

      /** Creditor — receiver of funds */
      Cdtr: {
        Nm?: string;  // Max 140 chars
        PstlAdr?: {
          Ctry?: string;
          AdrLine?: string[];
        };
      };

      /** Creditor Account */
      CdtrAcct: {
        Id: {
          Othr: {
            Id: string;          // Account number at receiving bank
            SchmeNm?: { Cd: 'BBAN' };
          };
        };
        Tp?: { Cd: 'CACC' | 'SVGS' };
      };

      /** Purpose (optional) */
      Purp?: { Cd?: string };

      /** Remittance information */
      RmtInf?: {
        Ustrd?: string;  // Max 140 chars unstructured
      };

      /** Local Instrument (FedNow specific) */
      LclInstrm?: {
        Prtry: 'INST';  // Instant payment
      };
    };
  };
}

/**
 * Translates a FedNow payment message to the canonical pacs.008 model.
 */
export async function fednowToCanonical(
  payload: FedNowPaymentMessage | Record<string, unknown>,
  paymentId: string,
  traceId?: string,
): Promise<CanonicalPacs008> {
  const log = logger.child({ payment_id: paymentId, rail: 'FEDNOW' });

  try {
    const msg = payload as FedNowPaymentMessage;
    const cdtTrf = msg.FIToFICstmrCdtTrf;
    const grp = cdtTrf.GrpHdr;
    const txn = cdtTrf.CdtTrfTxInf;

    const now = new Date().toISOString();
    const amount = parseFloat(txn.IntrBkSttlmAmt.value);

    // Extract RTNs (ABA routing numbers)
    const dbtrRtn = txn.DbtrAgt.FinInstnId.ClrSysMmbId.MmbId;
    const cdtrRtn = txn.CdtrAgt.FinInstnId.ClrSysMmbId.MmbId;

    // Extract account numbers
    const dbtrAccount = txn.DbtrAcct.Id.Othr.Id;
    const cdtrAccount = txn.CdtrAcct.Id.Othr.Id;

    // UETR as trace if provided
    const uetr = txn.PmtId.UETR;

    const raw = {
      payment_id: paymentId,
      created_at: now,
      grpHdr: {
        msgId: grp.MsgId ?? `MSG-${ulid()}`,
        creDtTm: grp.CreDtTm ?? now,
        nbOfTxs: 1,
        sttlmInf: { sttlmMtd: 'CLRG' as const },
      },
      pmtId: {
        endToEndId: txn.PmtId.EndToEndId.substring(0, 35),
        txId: txn.PmtId.TxId?.substring(0, 35),
        instrId: uetr?.substring(0, 35),
      },
      amount: {
        value: amount,
        currency: 'USD',  // FedNow only supports USD
      },
      origin: {
        rail: 'FEDNOW' as const,
        routingNumber: dbtrRtn,
        bic: undefined,
      },
      destination: {
        rail: undefined,
        routingNumber: cdtrRtn,
        bic: undefined,
      },
      debtor: {
        name: txn.Dbtr.Nm?.substring(0, 140),
        country: txn.Dbtr.PstlAdr?.Ctry ?? 'US',
        account_id: `${dbtrRtn}/${dbtrAccount}`,
        address: txn.Dbtr.PstlAdr?.AdrLine?.slice(0, 4),
      },
      creditor: {
        name: txn.Cdtr.Nm?.substring(0, 140),
        country: txn.Cdtr.PstlAdr?.Ctry ?? 'US',
        account_id: `${cdtrRtn}/${cdtrAccount}`,
        address: txn.Cdtr.PstlAdr?.AdrLine?.slice(0, 4),
      },
      alias: {
        type: 'ABA_ROUTING' as const,
        value: `${cdtrRtn}/${cdtrAccount}`,
      },
      purpose: txn.Purp?.Cd?.substring(0, 35) ?? 'P2P',
      reference: txn.PmtId.EndToEndId,
      remittanceInfo: txn.RmtInf?.Ustrd?.substring(0, 140),
      status: 'RECEIVED',
      trace_id: traceId ?? uetr,
    };

    const result = canonicalPacs008Schema.safeParse(raw);
    if (!result.success) {
      log.error({ errors: result.error.flatten() }, 'FedNow → Canonical validation failed');
      throw new TranslationError('FEDNOW', 'Invalid canonical output from FedNow translation', {
        zodErrors: result.error.flatten().fieldErrors,
      });
    }

    log.info('FedNow → Canonical translation complete');
    return result.data;
  } catch (err) {
    if (err instanceof TranslationError) throw err;
    log.error({ err }, 'Unexpected error in fednowToCanonical');
    throw new TranslationError('FEDNOW', 'Unexpected error during FedNow translation', { cause: err });
  }
}
