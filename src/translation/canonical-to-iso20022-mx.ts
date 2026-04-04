import { ulid } from 'ulid';
import type { CanonicalPacs008 } from '../domain/models/canonical.js';
import { logger } from '../observability/logger.js';
import type { Iso20022Pacs008 } from './iso20022-mx-to-canonical.js';

/**
 * Converts the canonical pacs.008 model to an ISO 20022 pacs.008.001.08 MX message.
 * This is both the format used internally (canonical) and the target for
 * ISO 20022 MX / FedNow / SEPA Credit Transfer translations.
 */
export async function canonicalToIso20022Mx(canonical: CanonicalPacs008): Promise<Iso20022Pacs008> {
  const log = logger.child({ payment_id: canonical.payment_id, destination: 'ISO20022_MX' });

  const creDtTm = canonical.grpHdr?.creDtTm ?? canonical.created_at;
  const isoDate = canonical.created_at.slice(0, 10);

  const dbtrAcct: Iso20022Pacs008['CdtTrfTxInf']['DbtrAcct'] = buildAccount(
    canonical.debtor.account_id,
    canonical.alias.type === 'IBAN' ? undefined : canonical.alias.type,
  );

  const cdtrAcct: Iso20022Pacs008['CdtTrfTxInf']['CdtrAcct'] = buildAccount(
    canonical.creditor.account_id,
    canonical.alias.type,
    canonical.alias.value,
  );

  const msg: Iso20022Pacs008 = {
    GrpHdr: {
      MsgId: canonical.grpHdr?.msgId ?? `MSG-${ulid()}`,
      CreDtTm: creDtTm,
      NbOfTxs: '1',
      SttlmInf: {
        SttlmMtd: ((canonical.grpHdr as Record<string, unknown>)?.sttlmInf as Record<string, unknown>)?.['sttlmMtd'] as 'CLRG' ?? 'CLRG',
      },
      InstgAgt: canonical.origin.bic
        ? { FinInstnId: { BICFI: canonical.origin.bic } }
        : undefined,
      InstdAgt: canonical.destination.bic
        ? { FinInstnId: { BICFI: canonical.destination.bic } }
        : undefined,
    },

    CdtTrfTxInf: {
      PmtId: {
        InstrId: canonical.pmtId.instrId,
        EndToEndId: canonical.pmtId.endToEndId,
        TxId: canonical.pmtId.txId,
      },

      IntrBkSttlmAmt: {
        Ccy: canonical.amount.currency,
        value: canonical.amount.value.toFixed(2),
      },

      InstdAmt: canonical.amount.instdAmt
        ? { Ccy: canonical.amount.instdAmtCcy ?? canonical.amount.currency, value: canonical.amount.instdAmt.toFixed(2) }
        : undefined,

      IntrBkSttlmDt: isoDate,

      XchgRate: canonical.fx?.rate ? String(canonical.fx.rate) : undefined,

      DbtrAgt: buildAgent(canonical.origin.bic, canonical.origin.routingNumber),
      Dbtr: buildParty(canonical.debtor),
      DbtrAcct: dbtrAcct,

      CdtrAgt: buildAgent(canonical.destination.bic, canonical.destination.routingNumber),
      Cdtr: buildParty(canonical.creditor),
      CdtrAcct: cdtrAcct,

      Purp: { Cd: canonical.purpose?.substring(0, 4) ?? 'OTHR' },

      RmtInf: buildRemittance(canonical),
    },
  };

  log.debug('Canonical → ISO 20022 MX translation complete');
  return msg;
}

/** Serializes an ISO 20022 pacs.008 to a wrapped Document JSON */
export function wrapInDocument(msg: Iso20022Pacs008): Record<string, unknown> {
  return {
    Document: {
      '@xmlns': 'urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08',
      FIToFICstmrCdtTrf: msg,
    },
  };
}

function buildAgent(
  bic?: string,
  routingNumber?: string,
): Iso20022Pacs008['CdtTrfTxInf']['DbtrAgt'] | undefined {
  if (!bic && !routingNumber) return undefined;
  return {
    FinInstnId: {
      BICFI: bic,
      ClrSysMmbId: routingNumber
        ? { ClrSysId: { Cd: 'USABA' }, MmbId: routingNumber }
        : undefined,
    },
  };
}

function buildParty(party: {
  name?: string;
  country?: string;
  account_id: string;
  taxId?: string;
  address?: string[];
}): Iso20022Pacs008['CdtTrfTxInf']['Dbtr'] {
  return {
    Nm: party.name?.substring(0, 140),
    PstlAdr: (party.country || party.address)
      ? {
          Ctry: party.country,
          AdrLine: party.address?.slice(0, 4),
        }
      : undefined,
    Id: party.taxId
      ? { PrvtId: { Othr: { Id: party.taxId.replace(/\D/g, '').substring(0, 35) } } }
      : undefined,
  };
}

function buildAccount(
  accountId: string,
  aliasType?: string,
  aliasValue?: string,
): { Id: { IBAN?: string; Othr?: { Id: string; SchmeNm?: { Cd?: string; Prtry?: string } } } } {
  const cleanId = accountId.replace(/^(PIX-|SPEI-|SWIFT-)/, '');

  if (aliasType === 'IBAN' || /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(cleanId)) {
    return { Id: { IBAN: aliasValue ?? cleanId } };
  }

  const schemeCode = mapAliasTypeToScheme(aliasType);
  return {
    Id: {
      Othr: {
        Id: aliasValue ?? cleanId,
        SchmeNm: schemeCode ? { Cd: schemeCode } : { Prtry: aliasType ?? 'ACCOUNT' },
      },
    },
  };
}

function mapAliasTypeToScheme(aliasType?: string): string | undefined {
  switch (aliasType) {
    case 'PIX_KEY': return 'BBAN';
    case 'CLABE':   return 'BBAN';
    case 'ABA_ROUTING': return 'ABA';
    case 'BIC':     return 'BIC';
    default:        return undefined;
  }
}

function buildRemittance(
  canonical: CanonicalPacs008,
): Iso20022Pacs008['CdtTrfTxInf']['RmtInf'] | undefined {
  const unstrd = canonical.remittanceInfo
    ?? (canonical.reference !== 'MIPIT-POC' ? canonical.reference : undefined);
  if (!unstrd) return undefined;
  return { Ustrd: unstrd.substring(0, 140) };
}
