/**
 * W6.2 — Rail rejection code → ISO 20022 ExternalStatusReason1Code mapping.
 *
 * Each productive rail uses its own catalogue of rejection codes (BACEN for
 * PIX, CECOBAN for SPEI, MIPIT-invented BREB001-005 for Bre-B until BanRep
 * TR-002 publishes the official list). Downstream consumers (correspondent
 * banks, ISO 20022 pacs.002 readers) only understand the ISO catalogue.
 *
 * This module maps proprietary → ISO with `Rsn.Prtry` preserved so the
 * original code is still auditable.
 *
 * Sources:
 *   - ISO 20022 ExternalCodeSets release 2024-05 (ExternalStatusReason1Code)
 *   - CBPR+ Usage Guidelines v9 §3.4 (Rsn.Cd ISO + Rsn.Prtry rail-native)
 *   - BACEN Manual de Códigos de Rejeição SPI Apêndice III
 *   - Banxico SPEI Operating Procedures (rejection codes R01-R09 + LIM/BLQ/CAN)
 */

export type IsoRejectionReason = {
  /** ISO 20022 ExternalStatusReason1Code value (4 chars). */
  cd: string;
  /** Rail-native proprietary code, preserved for audit. */
  prtry: string;
  /** Human-readable description. */
  description?: string;
};

/**
 * BACEN PIX rejection codes (Apêndice III, Manual de Códigos de Rejeição SPI).
 * Mapping derived from BACEN catalogue → ISO ExternalStatusReason1Code 2024-05.
 */
const BACEN_TO_ISO: Record<string, { cd: string; description: string }> = {
  AB03: { cd: 'AC01', description: 'Conta destino bloqueada / IncorrectAccountNumber' },
  AC01: { cd: 'AC01', description: 'Conta inválida' },
  AC03: { cd: 'AC04', description: 'CPF/CNPJ inválido — ClosedAccountNumber' },
  AC04: { cd: 'AC04', description: 'Conta fechada' },
  AM04: { cd: 'AM04', description: 'Saldo insuficiente' },
  AM18: { cd: 'AM18', description: 'Número inválido de parcelas' },
  BE01: { cd: 'BE01', description: 'Inconsistência cadastral' },
  DS04: { cd: 'AG01', description: 'Operação rejeitada pelo banco destinatário' },
  ED05: { cd: 'AG02', description: 'Liquidação rejeitada — InvalidBankOperationCode' },
  FF07: { cd: 'FF07', description: 'Propósito do pagamento ilegal/proibido' },
  MD06: { cd: 'MS03', description: 'Reservado para uso futuro' },
  RR04: { cd: 'NARR', description: 'Motivo regulatório / Narrative reason' },
};

/**
 * Banxico SPEI/CECOBAN rejection codes.
 * Mapping derived from Banxico SPEI Operating Procedures.
 */
const CECOBAN_TO_ISO: Record<string, { cd: string; description: string }> = {
  R01: { cd: 'AC01', description: 'Cuenta destino inválida' },
  R02: { cd: 'AC04', description: 'Cuenta destino cancelada' },
  R03: { cd: 'AC06', description: 'Cuenta destino bloqueada' },
  R04: { cd: 'AM05', description: 'Operación duplicada' },
  R05: { cd: 'AM02', description: 'Monto excede límite' },
  R06: { cd: 'AG01', description: 'Operación no permitida por banco receptor' },
  R07: { cd: 'AM21', description: 'Excede límite de tiempo' },
  R08: { cd: 'AC04', description: 'Beneficiario no localizado' },
  R09: { cd: 'AM04', description: 'Fondos insuficientes' },
  LIM: { cd: 'AM02', description: 'Límite operativo excedido' },
  BLQ: { cd: 'AC06', description: 'Cuenta bloqueada' },
  CAN: { cd: 'AC04', description: 'Cuenta cancelada' },
};

/**
 * MIPIT-invented BREB codes (pending BanRep TR-002 §7 publication).
 * Mapped to the closest ISO ExternalStatusReason1Code per audit-2 R-010.
 */
const BREB_TO_ISO: Record<string, { cd: string; description: string }> = {
  BREB001: { cd: 'AM04', description: 'Fondos insuficientes' },
  BREB002: { cd: 'AC01', description: 'Cuenta/entidad no encontrada' },
  BREB003: { cd: 'AM02', description: 'Límite de transacción excedido' },
  BREB004: { cd: 'BE01', description: 'Receptor no registrado en Bre-B' },
  BREB005: { cd: 'MS03', description: 'Timeout sistema' },
};

const CATALOGUES = {
  PIX: BACEN_TO_ISO,
  SPEI: CECOBAN_TO_ISO,
  BRE_B: BREB_TO_ISO,
} as const;

/**
 * Map a rail-native rejection code to an ISO 20022 reason.
 *
 * @param rail   The productive rail that produced the rejection.
 * @param code   The rail-native code (e.g. `AB03`, `R01`, `BREB001`).
 * @returns      `{ cd, prtry, description }` with `cd` ISO + `prtry` preserving the original.
 *               If the code is unknown, falls back to `cd: 'NARR'` (Narrative, generic) so
 *               downstream pacs.002 emission never produces an empty Rsn.Cd.
 */
export function mapRailRejectionToIso(
  rail: 'PIX' | 'SPEI' | 'BRE_B',
  code: string | undefined,
): IsoRejectionReason {
  if (!code) return { cd: 'NARR', prtry: 'UNSPECIFIED', description: 'No rail code provided' };
  const catalogue = CATALOGUES[rail];
  const hit = catalogue[code];
  if (hit) return { cd: hit.cd, prtry: code, description: hit.description };
  return { cd: 'NARR', prtry: code, description: 'Unmapped rail code' };
}

export const _internal = { BACEN_TO_ISO, CECOBAN_TO_ISO, BREB_TO_ISO };
