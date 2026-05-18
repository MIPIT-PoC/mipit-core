import { brebToCanonical, type BreBPaymentRequest, generateBrebTransactionId, BREB_ENTITY_CODES } from '../../../src/translation/breb-to-canonical';
import { canonicalToBreb } from '../../../src/translation/canonical-to-breb';
import type { CanonicalPacs008 } from '../../../src/domain/models/canonical';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeBrebRequest(overrides: Partial<BreBPaymentRequest> = {}): BreBPaymentRequest {
  return {
    idTransaccion: generateBrebTransactionId('26264220'),
    valor: { original: '500000.00' },
    pagador: {
      codigoEntidad: '26264220',
      nombre: 'Carlos López',
      nit: '900123456-1',
      numeroCuenta: '1234567890',
      tipoCuenta: 'CACC',
    },
    beneficiario: {
      codigoEntidad: '00000007',
      nombre: 'Ana García',
      nit: '800987654-3',
      numeroCuenta: '0987654321',
    },
    llave: '+573001234567',
    tipoLlave: 'TELEFONO',
    concepto: 'Pago de prueba MIPIT',
    fechaHora: '2023-06-01T12:00:00.000Z',
    ...overrides,
  };
}

const PAYMENT_ID = 'PMT-01J8ABCDEF0001';

// ─── brebToCanonical ────────────────────────────────────────────────────────

describe('brebToCanonical', () => {
  it('returns a valid CanonicalPacs008 object', async () => {
    const canonical = await brebToCanonical(makeBrebRequest(), PAYMENT_ID);
    expect(canonical.payment_id).toBe(PAYMENT_ID);
    expect(canonical.amount.currency).toBe('COP');
    expect(canonical.origin.rail).toBe('BRE_B');
  });

  it('maps valor.original to amount.value as float', async () => {
    const canonical = await brebToCanonical(makeBrebRequest({ valor: { original: '1500000.50' } }), PAYMENT_ID);
    expect(canonical.amount.value).toBe(1500000.5);
  });

  it('endToEndId is trimmed to 35 chars max', async () => {
    const canonical = await brebToCanonical(makeBrebRequest(), PAYMENT_ID);
    expect(canonical.pmtId.endToEndId.length).toBeLessThanOrEqual(35);
  });

  it('maps pagador.codigoEntidad to origin.ispb', async () => {
    const canonical = await brebToCanonical(makeBrebRequest(), PAYMENT_ID);
    expect(canonical.origin.ispb).toBe('26264220');
  });

  it('maps beneficiario.codigoEntidad to destination.ispb', async () => {
    const canonical = await brebToCanonical(makeBrebRequest(), PAYMENT_ID);
    expect(canonical.destination.ispb).toBe('00000007');
  });

  it('maps debtor account as codigoEntidad/account_id format', async () => {
    const canonical = await brebToCanonical(makeBrebRequest(), PAYMENT_ID);
    expect(canonical.debtor.account_id).toBe('26264220/900123456-1');
  });

  it('maps creditor account as codigoEntidad/account_id format', async () => {
    const canonical = await brebToCanonical(makeBrebRequest(), PAYMENT_ID);
    expect(canonical.creditor.account_id).toBe('00000007/800987654-3');
  });

  it('sets alias.type to LLAVE_BREB', async () => {
    const canonical = await brebToCanonical(makeBrebRequest(), PAYMENT_ID);
    expect(canonical.alias.type).toBe('LLAVE_BREB');
    expect(canonical.alias.value).toBe('+573001234567');
  });

  it('maps concepto to remittanceInfo', async () => {
    const canonical = await brebToCanonical(makeBrebRequest(), PAYMENT_ID);
    expect(canonical.remittanceInfo).toBe('Pago de prueba MIPIT');
  });

  it('sets debtor and creditor country to CO', async () => {
    const canonical = await brebToCanonical(makeBrebRequest(), PAYMENT_ID);
    expect(canonical.debtor.country).toBe('CO');
    expect(canonical.creditor.country).toBe('CO');
  });

  it('maps NIT taxId to canonical.debtor.taxId', async () => {
    const canonical = await brebToCanonical(makeBrebRequest(), PAYMENT_ID);
    expect(canonical.debtor.taxId).toBe('900123456-1');
    expect(canonical.creditor.taxId).toBe('800987654-3');
  });

  it('maps CC identification to taxId when no NIT', async () => {
    const req = makeBrebRequest({
      pagador: {
        codigoEntidad: '26264220',
        nombre: 'Persona Natural',
        cc: '12345678',
        numeroCuenta: '1234567890',
      },
    });
    const canonical = await brebToCanonical(req, PAYMENT_ID);
    expect(canonical.debtor.taxId).toBe('12345678');
    expect(canonical.debtor.account_id).toBe('26264220/12345678');
  });

  it('infers purpose SUPP for NIT-based payment (B2B)', async () => {
    // tipoLlave = NIT → SUPP
    const req = makeBrebRequest({ tipoLlave: 'NIT', llave: '800987654-3' });
    const canonical = await brebToCanonical(req, PAYMENT_ID);
    expect(canonical.purpose).toBe('SUPP');
  });

  it('uses P2P purpose for TELEFONO key type', async () => {
    const canonical = await brebToCanonical(makeBrebRequest(), PAYMENT_ID);
    expect(canonical.purpose).toBe('P2P');
  });

  it('sets status to RECEIVED', async () => {
    const canonical = await brebToCanonical(makeBrebRequest(), PAYMENT_ID);
    expect(canonical.status).toBe('RECEIVED');
  });

  it('sets trace_id when provided', async () => {
    const canonical = await brebToCanonical(makeBrebRequest(), PAYMENT_ID, 'trace-abc-123');
    expect(canonical.trace_id).toBe('trace-abc-123');
  });

  it('throws TranslationError for invalid payload', async () => {
    // Missing required fields
    await expect(brebToCanonical({} as BreBPaymentRequest, PAYMENT_ID)).rejects.toThrow();
  });
});

// ─── canonicalToBreb ────────────────────────────────────────────────────────

describe('canonicalToBreb', () => {
  async function makeCanonical(): Promise<CanonicalPacs008> {
    return brebToCanonical(makeBrebRequest(), PAYMENT_ID);
  }

  it('generates a valid idTransaccion (32 chars starting with BR)', async () => {
    const canonical = await makeCanonical();
    const breb = await canonicalToBreb(canonical);
    // W6.7 — idTransaccion is `BR + codigoEntidad(4|8) + YYYYMMDD + HHmm + 10 alnum`.
    // With the default 4-digit FINTECH_SIMULATED code it's 28 chars; legacy 8-digit
    // codes produce 32. The mock accepts both forms.
    expect(breb.idTransaccion).toMatch(/^BR(\d{4}|\d{8})\d{8}\d{4}[A-Z0-9]{10}$/);
    expect([28, 32]).toContain(breb.idTransaccion.length);
  });

  it('emits COP as integer (no centavos, per BanRep TR-002 §5)', async () => {
    // W5.10/W6.5 — COP is an integer-only currency; we used to .toFixed(2)
    // which the mock tolerated but a real BanRep sandbox would reject.
    const canonical = await makeCanonical();
    const breb = await canonicalToBreb(canonical);
    expect(breb.valor.original).toBe('500000');
  });

  it('sets pagador.codigoEntidad from origin.ispb', async () => {
    const canonical = await makeCanonical();
    const breb = await canonicalToBreb(canonical);
    // W6.7 — origin.ispb passes through verbatim if provided; otherwise the
    // 4-digit FINTECH_SIMULATED default is used. This fixture pre-set ispb.
    expect(breb.pagador.codigoEntidad).toBe('26264220');
  });

  it('sets beneficiario.codigoEntidad from destination.ispb', async () => {
    const canonical = await makeCanonical();
    const breb = await canonicalToBreb(canonical);
    expect(breb.beneficiario.codigoEntidad).toBe('00000007');
  });

  it('strips entity prefix from pagador.numeroCuenta', async () => {
    const canonical = await makeCanonical();
    const breb = await canonicalToBreb(canonical);
    // account_id was "26264220/900123456-1" → numeroCuenta should be "900123456-1"
    expect(breb.pagador.numeroCuenta).toBe('900123456-1');
  });

  it('maps NIT taxId to beneficiario.nit (has hyphen)', async () => {
    const canonical = await makeCanonical();
    const breb = await canonicalToBreb(canonical);
    expect(breb.beneficiario.nit).toBe('800987654-3');
    expect(breb.beneficiario.cc).toBeUndefined();
  });

  it('maps llave from LLAVE_BREB alias', async () => {
    const canonical = await makeCanonical();
    const breb = await canonicalToBreb(canonical);
    expect(breb.llave).toBe('+573001234567');
  });

  it('maps remittanceInfo to concepto', async () => {
    const canonical = await makeCanonical();
    const breb = await canonicalToBreb(canonical);
    expect(breb.concepto).toBe('Pago de prueba MIPIT');
  });

  it('falls back to FINTECH_SIMULATED entity when ispb not set', async () => {
    const canonical = await makeCanonical();
    // Override destination ispb
    const modified = {
      ...canonical,
      destination: { ...canonical.destination, ispb: undefined },
    } as unknown as CanonicalPacs008;

    const breb = await canonicalToBreb(modified);
    expect(breb.beneficiario.codigoEntidad).toBe(BREB_ENTITY_CODES.FINTECH_SIMULATED);
  });
});

// ─── Round-trip test ────────────────────────────────────────────────────────

describe('Bre-B round-trip: BreB → canonical → BreB', () => {
  it('preserves amount, llave, and entity codes across a round-trip', async () => {
    const original = makeBrebRequest();
    const canonical = await brebToCanonical(original, PAYMENT_ID);
    const reconstructed = await canonicalToBreb(canonical);

    // W5.10/W6.5 — COP must round-trip as integer (no centavos). The fixture
    // sends '500000.00' (legacy form); the outbound side normalizes to '500000'.
    expect(parseFloat(reconstructed.valor.original)).toBe(parseFloat(original.valor.original));
    expect(reconstructed.valor.original).not.toContain('.'); // integer form
    expect(reconstructed.llave).toBe(original.llave);
    expect(reconstructed.pagador.codigoEntidad).toBe(original.pagador.codigoEntidad);
    expect(reconstructed.beneficiario.codigoEntidad).toBe(original.beneficiario.codigoEntidad);
    expect(reconstructed.pagador.nombre).toBe(original.pagador.nombre);
    expect(reconstructed.beneficiario.nombre).toBe(original.beneficiario.nombre);
  });

  it('preserves NIT identifications across a round-trip', async () => {
    const original = makeBrebRequest();
    const canonical = await brebToCanonical(original, PAYMENT_ID);
    const reconstructed = await canonicalToBreb(canonical);

    expect(reconstructed.pagador.nit).toBe(original.pagador.nit);
    expect(reconstructed.beneficiario.nit).toBe(original.beneficiario.nit);
  });

  it('new idTransaccion is generated on each reconstruction (not preserved)', async () => {
    const original = makeBrebRequest();
    const canonical = await brebToCanonical(original, PAYMENT_ID);
    const reconstructed = await canonicalToBreb(canonical);

    // A new idTransaccion is generated each time fromCanonical is called
    expect(reconstructed.idTransaccion).not.toBe(original.idTransaccion);
    expect(reconstructed.idTransaccion).toMatch(/^BR/);
  });
});

// ─── generateBrebTransactionId ──────────────────────────────────────────────

describe('generateBrebTransactionId', () => {
  // W6.7 — codigoEntidad is now 4-dig Superfinanciera by default, so the
  // total length is `BR(2) + entidad(4) + YYYYMMDD(8) + HHmm(4) + 10alnum = 28`.
  // Legacy 8-digit codes still produce 32 chars; the mock accepts both forms.

  it('has 28 chars with the default 4-digit FINTECH_SIMULATED entity', () => {
    expect(generateBrebTransactionId()).toHaveLength(28);
  });

  it('has 32 chars with a legacy 8-digit entity code', () => {
    expect(generateBrebTransactionId('00000007')).toHaveLength(32);
  });

  it('starts with BR + 8-digit entity code (legacy form)', () => {
    const id = generateBrebTransactionId('00000007');
    expect(id.substring(0, 10)).toBe('BR00000007');
  });

  it('starts with BR + 4-digit entity code (modern form)', () => {
    const id = generateBrebTransactionId('0007');
    expect(id.substring(0, 6)).toBe('BR0007');
  });

  it('embeds YYYYMMDD after the entity code', () => {
    const id = generateBrebTransactionId('0007');
    // After 'BR' (2) + entity (4) the next 8 chars are YYYYMMDD.
    const datePart = id.substring(6, 14);
    expect(/^\d{8}$/.test(datePart)).toBe(true);
    expect(parseInt(datePart.substring(0, 4), 10)).toBeGreaterThanOrEqual(2023);
  });

  it('embeds HHmm after the date', () => {
    const id = generateBrebTransactionId('0007');
    const timePart = id.substring(14, 18);
    expect(/^\d{4}$/.test(timePart)).toBe(true);
  });

  it('ends with 10 uppercase alphanumeric chars (unique suffix)', () => {
    const id = generateBrebTransactionId('0007');
    expect(/^[A-Z0-9]{10}$/.test(id.substring(18))).toBe(true);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateBrebTransactionId()));
    expect(ids.size).toBe(100);
  });
});
