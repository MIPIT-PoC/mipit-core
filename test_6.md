# Tests Unitarios — Semana 6

---

# Tests Unitarios — `src/translation/mapping-loader.ts`

Archivo de test sugerido: `test/unit/translation/mapping-loader.test.ts`

## Estrategia general

Mockear `MappingRepository` (inyectado por constructor) y `logger`. Usar `jest.spyOn(Date, 'now')` para controlar el TTL.

## Test 1: Primera llamada consulta DB
- Llamar `loadMappings('PIX', 'TO_CANONICAL')`.
- Verificar que `repo.findByRail` fue llamado con `['PIX', 'TO_CANONICAL']`.
- Verificar que retorna las entries del mock.

## Test 2: Segunda llamada retorna de cache
- Llamar `loadMappings` dos veces con mismos params.
- Verificar que `repo.findByRail` fue llamado solo 1 vez.

## Test 3: Cache expira después de TTL (5 min)
- Llamar `loadMappings` una vez.
- Avanzar `Date.now()` 5 minutos + 1ms.
- Llamar de nuevo.
- Verificar que `repo.findByRail` fue llamado 2 veces.

## Test 4: Keys diferentes no comparten cache
- Llamar `loadMappings('PIX', 'TO_CANONICAL')` y luego `loadMappings('SPEI', 'TO_CANONICAL')`.
- Verificar que `repo.findByRail` fue llamado 2 veces con params distintos.

## Test 5: `clearCache()` fuerza recarga
- Llamar `loadMappings`, luego `clearCache()`, luego `loadMappings` de nuevo.
- Verificar que `repo.findByRail` fue llamado 2 veces.

## Test 6: Logging muestra source 'cache' o 'db'
- Llamar `loadMappings` dos veces.
- Verificar que `logger.debug` fue llamado con `source: 'db'` la primera vez y `source: 'cache'` la segunda.

---

# Tests Unitarios — `src/translation/pix-to-canonical.ts`

Archivo de test sugerido: `test/unit/translation/pix-to-canonical.test.ts`

## Estrategia general

Mockear `ulid` (retorno fijo), `logger`. Pasar un `CreatePaymentRequest` válido.

## Test 1: Traduce payload PIX válido a CanonicalPacs008
- Pasar request con amount, debtor, creditor, currency BRL.
- Verificar que retorna un objeto con `origin.rail === 'PIX'`, `alias.type === 'PIX_KEY'`, amount correcto.

## Test 2: Extrae alias PIX quitando prefijo `PIX-`
- Creditor alias = `PIX-abc123`.
- Verificar `alias.value === 'abc123'`.

## Test 3: Usa BRL como currency por defecto si no se especifica
- No enviar currency en el request.
- Verificar `amount.currency === 'BRL'`.

## Test 4: Lanza TranslationError si amount es negativo
- Pasar amount negativo.
- Verificar que lanza `TranslationError` con rail 'PIX'.

## Test 5: Incluye trace_id si se proporciona
- Pasar traceId.
- Verificar `result.trace_id` coincide.

---

# Tests Unitarios — `src/translation/spei-to-canonical.ts`

Archivo de test sugerido: `test/unit/translation/spei-to-canonical.test.ts`

## Estrategia general

Mockear `ulid`, `logger`. Pasar un `CreatePaymentRequest` válido con formato SPEI.

## Test 1: Traduce payload SPEI válido a CanonicalPacs008
- Verificar `origin.rail === 'SPEI'`, `alias.type === 'CLABE'`, amount correcto.

## Test 2: Extrae alias CLABE quitando prefijo `CLABE-`
- Creditor alias = `CLABE-012345678901234567`.
- Verificar `alias.value === '012345678901234567'`.

## Test 3: Usa MXN como currency por defecto
- Verificar `amount.currency === 'MXN'`.

## Test 4: Lanza TranslationError si el esquema no valida
- Pasar amount negativo.
- Verificar `TranslationError`.

---

# Tests Unitarios — `src/translation/canonical-to-pix.ts`

Archivo de test sugerido: `test/unit/translation/canonical-to-pix.test.ts`

## Estrategia general

Crear un `CanonicalPacs008` válido y verificar la transformación.

## Test 1: Genera PixOutboundPayload correcto
- Verificar que `pixKey` = `alias.value`, `endToEndId` = `pmtId.endToEndId`, amount coincide.

## Test 2: Mapea debtor/creditor names correctamente
- Verificar `debtorName`, `creditorName` del canonical.

## Test 3: Incluye purpose y reference
- Verificar que se copian del canonical.

---

# Tests Unitarios — `src/translation/canonical-to-spei.ts`

Archivo de test sugerido: `test/unit/translation/canonical-to-spei.test.ts`

## Estrategia general

Crear un `CanonicalPacs008` válido y verificar la transformación a SPEI.

## Test 1: Genera SpeiOutboundPayload correcto
- Verificar `clabe` = `alias.value`, `claveRastreo` = `pmtId.endToEndId`.

## Test 2: `fechaOperacion` es solo la fecha (sin hora)
- Verificar formato `YYYY-MM-DD`.

## Test 3: Mapea montos y moneda correctamente
- Verificar `monto` = `amount.value`, `moneda` = `amount.currency`.

---

# Tests Unitarios — `src/translation/translator.ts`

Archivo de test sugerido: `test/unit/translation/translator.test.ts`

## Estrategia general

Mockear `pixToCanonical`, `speiToCanonical`, `canonicalToPix`, `canonicalToSpei`, `logger`, y `metrics` (`startLatencyTimer`, `recordTranslationError`).

## Test 1: `toCanonical('PIX', ...)` invoca `pixToCanonical`
- Verificar que se delega correctamente y el timer se detiene.

## Test 2: `toCanonical('SPEI', ...)` invoca `speiToCanonical`
- Verificar delegación.

## Test 3: `toCanonical` con rail no soportado lanza TranslationError
- Pasar rail 'SWIFT'.
- Verificar que lanza `TranslationError` y `recordTranslationError` se llama.

## Test 4: `fromCanonical('PIX', ...)` invoca `canonicalToPix`
- Verificar delegación y que el timer se detiene.

## Test 5: `fromCanonical('SPEI', ...)` invoca `canonicalToSpei`
- Verificar delegación.

## Test 6: Error en traducción registra métrica y logging
- Mockear `pixToCanonical` para que lance error.
- Verificar `recordTranslationError('PIX', 'unexpected')` y `log.error` llamados.

---

# Tests Unitarios — `src/normalization/rules/date-rules.ts` y `currency-rules.ts`

Archivo de test sugerido: cubiertos en `test/unit/normalization/normalizer.test.ts` (CORE-021)

## Tests de date-rules (cubiertos via Normalizer)

### Test 1: Fecha no-UTC se convierte a UTC ISO-8601
- Input: `created_at: '2025-06-15 14:30:00-05:00'`
- Expected: `'2025-06-15T19:30:00.000Z'`

### Test 2: Fecha inválida no crashea
- Input: `created_at: 'not-a-date'`
- Expected: mantiene valor original, genera log warning.

### Test 3: Fecha ya en UTC no cambia
- Input: `created_at: '2025-06-15T12:00:00.000Z'`
- Expected: idéntico.

## Tests de currency-rules (cubiertos via Normalizer)

### Test 4: Currency lowercase se convierte a uppercase
- Input: `amount.currency: 'usd'` → `'USD'`.

### Test 5: FX se setea para PIX con currency no-BRL
- `origin.rail: 'PIX'`, `currency: 'USD'` → `fx.source_currency = 'BRL'`, `fx.target_currency = 'USD'`.

### Test 6: FX no se setea si currency ya es la local del rail
- `origin.rail: 'PIX'`, `currency: 'BRL'` → `fx.target_currency` undefined.

### Test 7: FX se setea para SPEI con currency no-MXN
- `origin.rail: 'SPEI'`, `currency: 'BRL'` → `fx.source_currency = 'MXN'`, `fx.target_currency = 'BRL'`.

---

# Tests Unitarios — `src/normalization/normalizer.ts`

Archivo de test sugerido: `test/unit/normalization/normalizer.test.ts`

## Estrategia general

Mockear `logger` y `metrics` (`startLatencyTimer`). Usar un `CanonicalPacs008` válido como fixture base.

## Test 1: Normalización ejecuta las 4 reglas en orden
- Verificar que `normalizeDates`, `normalizeCurrency`, `normalizeIds`, `applyFallbacks` se aplican.

## Test 2: Timer de latencia se inicia y detiene
- Verificar que `startLatencyTimer('normalization')` se llama y el stop callback se ejecuta.

## Test 3: Logger registra inicio y fin
- Verificar que `log.info` se llama con 'Starting normalization' y 'Normalization complete'.

---

# Tests Unitarios — `src/routing/rule-loader.ts`

Archivo de test sugerido: `test/unit/routing/rule-loader.test.ts`

## Estrategia general

Mockear `RouteRuleRepository` y `logger`. Usar `jest.spyOn(Date, 'now')` para controlar TTL.

## Test 1: Primera llamada consulta DB
- `loadActiveRules()` llama `repo.findActive()` y retorna las rules.

## Test 2: Segunda llamada usa cache
- Llamar dos veces → `repo.findActive()` se llama solo 1 vez.

## Test 3: Cache expira tras 5 min
- Avanzar `Date.now()` 5 min + 1ms entre llamadas → `repo.findActive()` se llama 2 veces.

## Test 4: `clearCache()` fuerza recarga
- Llamar, `clearCache()`, llamar de nuevo → `repo.findActive()` se llama 2 veces.

## Test 5: Logging muestra source correcto
- Primera llamada: `source: 'db'`. Segunda: `source: 'cache'`.

---

# Tests Unitarios — `src/routing/route-engine.ts`

Archivo de test sugerido: `test/unit/routing/route-engine.test.ts`

## Estrategia general

Mockear `RuleLoader`, `logger`, `metrics` (`startLatencyTimer`, `recordRoutingDecision`).

## Test 1: Resuelve ruta para alias PIX_KEY
- Rules con `condition_field: 'alias.type'`, `condition_value: 'PIX_KEY'` → `destination: 'PIX'`.
- Canonical con `creditor.account_id` que empiece con `PIX-`.

## Test 2: Resuelve ruta para alias CLABE (SPEI)
- Rules con `condition_value: 'CLABE'` → `destination: 'SPEI'`.

## Test 3: Respeta prioridad — rule con menor priority gana
- Dos rules que ambas matchean; la de menor priority se selecciona.

## Test 4: Lanza RoutingError si ninguna regla matchea
- Canonical sin alias reconocible → `RoutingError`.

## Test 5: `recordRoutingDecision` se llama con rule_name y destination
- Verificar que la métrica se registra correctamente.

## Test 6: Timer de latencia se detiene tanto en éxito como en error
- Verificar que `stopTimer` se llama en ambos paths.
