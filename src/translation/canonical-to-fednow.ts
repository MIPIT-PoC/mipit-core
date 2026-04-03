import { ulid } from 'ulid';
import type { CanonicalPacs008 } from '../domain/models/canonical.js';
import { logger } from '../observability/logger.js';
import type { FedNowPaymentMessage } from './fednow-to-canonical.js';

/**
 * Converts the canonical pacs.008 model to a FedNow payment message.
 * FedNow uses ISO 20022 pacs.008.001.08 in JSON format.
 * Settlement currency is always USD.
 */
export async function canonicalToFednow(canonical: CanonicalPacs008): Promise<FedNowPaymentMessage> {
  const log = logger.child({ payment_id: canonical.payment_id, destination: 'FEDNOW' });

  const now = new Date().toISOString();
  const isoDate = canonical.created_at.slice(0, 10);

  // Extract ABA routing + account from alias or origin/destination
  const [cdtrRtn, cdtrAccount] = extractRtnAndAccount(
    canonical.alias.value,
    canonical.destination.routingNumber ?? '021000021',
    canonical.creditor.account_id,
  );

  const [dbtrRtn, dbtrAccount] = extractRtnAndAccount(
    canonical.debtor.account_id,
    canonical.origin.routingNumber ?? '021000021',
    canonical.debtor.account_id,
  );

  // FedNow only supports USD — convert if needed
  const amountUsd = canonical.amount.currency === 'USD'
    ? canonical.amount.value
    : (canonical.fx?.local_amount ?? canonical.amount.value * (canonical.fx?.rate ?? 1));

  // Generate UETR (Unique End-to-End Transaction Reference) — UUID v4
  const uetr = generateUetr();

  const bizMsgId = `${canonical.payment_id.replace('PMT-', 'BIZ-').substring(0, 35)}`;

  const msg: FedNowPaymentMessage = {
    BusinessMessageHeader: {
      Fr: {
        FIId: {
          FinInstnId: {
            ClrSysMmbId: {
              MmbId: dbtrRtn,
            },
          },
        },
      },
      To: {
        FIId: {
          FinInstnId: {
            ClrSysMmbId: {
              MmbId: cdtrRtn,
            },
          },
        },
      },
      BizMsgIdr: bizMsgId,
      MsgDefIdr: 'pacs.008.001.08',
      BizSvc: 'fednow',
      CreDt: now,
    },

    FIToFICstmrCdtTrf: {
      GrpHdr: {
        MsgId: canonical.grpHdr?.msgId ?? `MSG-${ulid()}`,
        CreDtTm: now,
        NbOfTxs: '1',
        SttlmInf: {
          SttlmMtd: 'CLRG',
          ClrSys: { Cd: 'USABA' },
        },
      },

      CdtTrfTxInf: {
        PmtId: {
          EndToEndId: canonical.pmtId.endToEndId.substring(0, 35),
          TxId: canonical.pmtId.txId,
          UETR: uetr,
        },

        IntrBkSttlmAmt: {
          Ccy: 'USD',
          value: amountUsd.toFixed(2),
        },

        IntrBkSttlmDt: isoDate,

        DbtrAgt: {
          FinInstnId: {
            ClrSysMmbId: {
              ClrSysId: { Cd: 'USABA' },
              MmbId: dbtrRtn,
            },
          },
        },

        Dbtr: {
          Nm: canonical.debtor.name?.substring(0, 140),
          PstlAdr: {
            Ctry: canonical.debtor.country ?? 'US',
            AdrLine: canonical.debtor.address?.slice(0, 4),
          },
        },

        DbtrAcct: {
          Id: {
            Othr: {
              Id: dbtrAccount.substring(0, 34),
              SchmeNm: { Cd: 'BBAN' },
            },
          },
          Tp: { Cd: 'CACC' },
        },

        CdtrAgt: {
          FinInstnId: {
            ClrSysMmbId: {
              ClrSysId: { Cd: 'USABA' },
              MmbId: cdtrRtn,
            },
          },
        },

        Cdtr: {
          Nm: canonical.creditor.name?.substring(0, 140),
          PstlAdr: {
            Ctry: canonical.creditor.country ?? 'US',
            AdrLine: canonical.creditor.address?.slice(0, 4),
          },
        },

        CdtrAcct: {
          Id: {
            Othr: {
              Id: cdtrAccount.substring(0, 34),
              SchmeNm: { Cd: 'BBAN' },
            },
          },
          Tp: { Cd: 'CACC' },
        },

        Purp: { Cd: canonical.purpose.substring(0, 4) },

        RmtInf: canonical.remittanceInfo
          ? { Ustrd: canonical.remittanceInfo.substring(0, 140) }
          : undefined,

        LclInstrm: { Prtry: 'INST' },
      },
    },
  };

  log.debug('Canonical → FedNow translation complete');
  return msg;
}

/** Extracts ABA RTN and account from alias value or falls back to routing + account */
function extractRtnAndAccount(
  aliasValue: string,
  defaultRtn: string,
  accountFallback: string,
): [string, string] {
  const clean = aliasValue.replace(/^(PIX-|SPEI-)/, '');
  // Format: "RTN/Account" (e.g. "021000021/1234567890")
  if (/^\d{9}\//.test(clean)) {
    const [rtn, ...rest] = clean.split('/');
    return [rtn, rest.join('/').replace(/^(PIX-|SPEI-)/, '')];
  }
  // Otherwise use default RTN and clean account
  return [defaultRtn, accountFallback.replace(/^(PIX-|SPEI-)/, '')];
}

/** Generates a RFC 4122 UUID v4 for UETR */
function generateUetr(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
