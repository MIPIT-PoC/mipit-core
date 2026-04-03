export const PAYMENT_STATUS = {
  RECEIVED: 'RECEIVED',
  VALIDATED: 'VALIDATED',
  CANONICALIZED: 'CANONICALIZED',
  ROUTED: 'ROUTED',
  QUEUED: 'QUEUED',
  SENT_TO_DESTINATION: 'SENT_TO_DESTINATION',
  ACKED_BY_RAIL: 'ACKED_BY_RAIL',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REJECTED: 'REJECTED',
  DUPLICATE: 'DUPLICATE',
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

/**
 * All supported payment rails.
 * PIX, SPEI, and BRE_B have full adapters (RabbitMQ consumers).
 * SWIFT_MT103, ISO20022_MX, ACH_NACHA, FEDNOW have translation support only (future adapters).
 */
export const RAILS = {
  PIX: 'PIX',
  SPEI: 'SPEI',
  SWIFT_MT103: 'SWIFT_MT103',
  ISO20022_MX: 'ISO20022_MX',
  ACH_NACHA: 'ACH_NACHA',
  FEDNOW: 'FEDNOW',
  BRE_B: 'BRE_B',
} as const;

export type Rail = (typeof RAILS)[keyof typeof RAILS];

/** Alias types used to identify accounts across rails */
export const ALIAS_TYPES = {
  PIX_KEY: 'PIX_KEY',         // CPF, CNPJ, phone, email, EVP (Brazil PIX)
  CLABE: 'CLABE',             // 18-digit bank account (Mexico SPEI)
  IBAN: 'IBAN',               // International Bank Account Number (SWIFT/SEPA)
  ACCOUNT: 'ACCOUNT',         // Generic account number
  ABA_ROUTING: 'ABA_ROUTING', // ABA routing + account (US ACH / FedNow)
  BIC: 'BIC',                 // BIC/SWIFT code
  LLAVE_BREB: 'LLAVE_BREB',   // Bre-B alias (phone +57, NIT, email, or alias) — Colombia
} as const;

export type AliasType = (typeof ALIAS_TYPES)[keyof typeof ALIAS_TYPES];

export const RAIL_METADATA: Record<Rail, {
  name: string;
  country: string;
  currency: string;
  region: string;
  hasAdapter: boolean;
  standard: string;
}> = {
  PIX: {
    name: 'PIX',
    country: 'BR',
    currency: 'BRL',
    region: 'LATAM',
    hasAdapter: true,
    standard: 'ISO 20022 / BACEN SPI',
  },
  SPEI: {
    name: 'SPEI',
    country: 'MX',
    currency: 'MXN',
    region: 'LATAM',
    hasAdapter: true,
    standard: 'CECOBAN / BANXICO',
  },
  SWIFT_MT103: {
    name: 'SWIFT MT103',
    country: 'GLOBAL',
    currency: 'USD',
    region: 'GLOBAL',
    hasAdapter: false,
    standard: 'SWIFT MT (legacy FIN)',
  },
  ISO20022_MX: {
    name: 'ISO 20022 MX',
    country: 'GLOBAL',
    currency: 'USD',
    region: 'GLOBAL',
    hasAdapter: false,
    standard: 'ISO 20022 pacs.008.001.08 XML',
  },
  ACH_NACHA: {
    name: 'ACH NACHA',
    country: 'US',
    currency: 'USD',
    region: 'USA',
    hasAdapter: false,
    standard: 'NACHA ACH CCD/PPD',
  },
  FEDNOW: {
    name: 'FedNow',
    country: 'US',
    currency: 'USD',
    region: 'USA',
    hasAdapter: false,
    standard: 'ISO 20022 JSON (Federal Reserve)',
  },
  BRE_B: {
    name: 'Bre-B',
    country: 'CO',
    currency: 'COP',
    region: 'LATAM',
    hasAdapter: true,
    standard: 'ISO 20022 JSON (Banco de la República Colombia)',
  },
};

export const EXCHANGES = { PAYMENTS: 'mipit.payments' } as const;
export const ROUTING_KEYS = {
  ROUTE_PIX:  'route.pix',
  ROUTE_SPEI: 'route.spei',
  ROUTE_BREB: 'route.breb',
  ACK_PIX:    'ack.pix',
  ACK_SPEI:   'ack.spei',
  ACK_BREB:   'ack.breb',
} as const;
export const QUEUES = { ACK: 'payments.ack' } as const;
