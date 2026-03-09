# Tests Unitarios — `src/observability/logger.ts`

Archivo de test sugerido: `test/unit/observability/logger.test.ts`

## Estrategia general

El logger de Pino escribe a un stream. Para capturar output en tests, se crea una instancia de Pino con un stream custom (`pino.destination` o un `Writable` en memoria) y se parsea el JSON emitido. Para el mixin de OTel, se mockea `@opentelemetry/api` con `jest.mock`.

---

## Test 1: Logger emite JSON estructurado

**Objetivo:** Verificar que `logger.info('hello')` produce un objeto JSON con los campos mínimos esperados.

**Cómo:**
- Crear un Pino logger con las mismas opciones que `logger.ts` pero escribiendo a un buffer.
- Llamar `.info('hello')`.
- Parsear el JSON y verificar que contiene: `level`, `time`, `service`, `msg`.

**Resultado esperado:**
```json
{ "level": "info", "time": "2025-...", "service": "mipit-core", "msg": "hello" }
```

---

## Test 2: Campo `service` tiene el valor de OTEL_SERVICE_NAME

**Objetivo:** Verificar que el campo `service` en el output JSON coincide con la variable de entorno.

**Cómo:**
- Setear `process.env.OTEL_SERVICE_NAME = 'test-service'` antes de importar.
- Verificar que el JSON emitido contiene `"service": "test-service"`.

---

## Test 3: Campo `level` es string, no número

**Objetivo:** Verificar que el formatter personalizado emite `"info"` en vez del código numérico de Pino (`30`).

**Cómo:**
- Emitir un log con `.info()`.
- Parsear JSON y verificar `typeof output.level === 'string'` y `output.level === 'info'`.

---

## Test 4: Timestamp en formato ISO 8601

**Objetivo:** Verificar que el campo `time` es una fecha ISO válida.

**Cómo:**
- Emitir un log y parsear JSON.
- Verificar que `new Date(output.time).toISOString() === output.time` (roundtrip válido).

---

## Test 5: Mixin inyecta `trace_id` y `span_id` cuando hay span activo

**Objetivo:** Verificar que cuando OTel tiene un span activo, cada línea de log incluye `trace_id` y `span_id` automáticamente.

**Cómo:**
- Mockear `@opentelemetry/api`:
  ```typescript
  jest.mock('@opentelemetry/api', () => ({
    trace: {
      getActiveSpan: () => ({
        spanContext: () => ({
          traceId: 'abc123trace',
          spanId: 'def456span',
        }),
      }),
    },
  }));
  ```
- Emitir un log y verificar que el JSON contiene `trace_id: 'abc123trace'` y `span_id: 'def456span'`.

---

## Test 6: Mixin no inyecta nada cuando no hay span activo

**Objetivo:** Verificar que sin span activo, no aparecen `trace_id` ni `span_id` en el log.

**Cómo:**
- Mockear `trace.getActiveSpan()` para que retorne `undefined`.
- Emitir un log y verificar que el JSON **no** contiene las propiedades `trace_id` ni `span_id`.

---

## Test 7: `createChildLogger` hereda config y agrega bindings

**Objetivo:** Verificar que un child logger incluye tanto los campos base (`service`) como los bindings adicionales.

**Cómo:**
- Llamar `createChildLogger({ module: 'persistence', payment_id: 'pay_123' })`.
- Emitir un log con el child.
- Verificar que el JSON contiene `service`, `module`, `payment_id` y `msg`.

---

## Test 8: `LOG_LEVEL` controla qué logs se emiten

**Objetivo:** Verificar que un logger con nivel `warn` no emite logs de nivel `info` pero sí de nivel `warn` y superiores.

**Cómo:**
- Crear logger con `level: 'warn'`.
- Llamar `.info('should not appear')` — verificar que el buffer está vacío.
- Llamar `.warn('should appear')` — verificar que el buffer tiene contenido.

---

---

# Tests Unitarios — `src/persistence/db.ts`

Archivo de test sugerido: `test/unit/persistence/db.test.ts`

## Estrategia general

Mockear el módulo `pg` completo con `jest.mock('pg')`. El mock de `Pool` debe exponer `.query()`, `.on()`, `.end()`, y `.connect()` como jest functions controlables. Mockear también `../observability/logger.js` para verificar llamadas a `logger.info` y `logger.error`.

---

## Test 1: `connectDb` crea pool y ejecuta `SELECT 1`

**Objetivo:** Verificar que `connectDb` crea una instancia de Pool con los parámetros correctos y ejecuta el health check.

**Cómo:**
- Mockear `Pool` para que `.query('SELECT 1')` resuelva ok.
- Llamar `connectDb('postgres://...')`.
- Verificar que el constructor de Pool fue llamado con `{ connectionString, max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 }`.
- Verificar que `.query('SELECT 1')` fue llamado.
- Verificar que retorna la instancia del pool.

---

## Test 2: `connectDb` loguea error y relanza si la conexión falla

**Objetivo:** Verificar que si `pool.query` falla, se loguea el error, se resetea pool a null, y se propaga la excepción.

**Cómo:**
- Mockear `Pool.query` para que lance `new Error('connection refused')`.
- Llamar `connectDb(...)` dentro de un `expect(...).rejects.toThrow()`.
- Verificar que `logger.error` fue llamado con el objeto de error.
- Verificar que `getPool()` lanza `'Database pool not initialized'` (pool quedó null).

---

## Test 3: `getPool` retorna el pool cuando está inicializado

**Objetivo:** Verificar que después de `connectDb`, `getPool()` retorna la misma instancia.

**Cómo:**
- Llamar `connectDb(...)`.
- Llamar `getPool()`.
- Verificar que ambos retornan la misma referencia (`toBe`).

---

## Test 4: `getPool` lanza error si no se ha llamado `connectDb`

**Objetivo:** Verificar que sin inicializar, `getPool()` lanza un error descriptivo.

**Cómo:**
- Sin llamar `connectDb`, invocar `getPool()`.
- Verificar que lanza `Error('Database pool not initialized')`.

---

## Test 5: `disconnectDb` llama `pool.end()` y resetea a null

**Objetivo:** Verificar que la desconexión limpia el estado del módulo.

**Cómo:**
- Llamar `connectDb(...)`.
- Llamar `disconnectDb()`.
- Verificar que `pool.end()` fue llamado una vez.
- Verificar que `getPool()` lanza después de la desconexión.

---

## Test 6: `disconnectDb` no falla si no hay pool

**Objetivo:** Verificar que llamar `disconnectDb()` sin pool activo es una operación segura (no-op).

**Cómo:**
- Sin llamar `connectDb`, invocar `disconnectDb()`.
- Verificar que no lanza error.

---

## Test 7: Pool params son correctos

**Objetivo:** Verificar que el constructor de Pool recibe exactamente los parámetros esperados.

**Cómo:**
- Llamar `connectDb('postgres://test')`.
- Inspeccionar los argumentos del constructor de Pool mockeado.
- Verificar: `max: 20`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 5000`, `connectionString: 'postgres://test'`.

---

## Test 8: `pool.on('error')` está registrado

**Objetivo:** Verificar que se registra un listener de errores en el pool para idle clients.

**Cómo:**
- Llamar `connectDb(...)`.
- Verificar que `pool.on` fue llamado con `'error'` y una función como callback.
- Simular un error invocando el callback registrado.
- Verificar que `logger.error` fue llamado con el mensaje de idle client.

---

---

# Tests Unitarios — `src/observability/metrics.ts`

Archivo de test sugerido: `test/unit/observability/metrics.test.ts`

## Estrategia general

Importar directamente las métricas y helpers desde `metrics.ts`. Usar `registry.getMetricsAsJSON()` para inspeccionar el estado del registry después de cada operación. Resetear métricas entre tests con `registry.resetMetrics()`.

---

## Test 1: Las 5 métricas están registradas en el registry

**Objetivo:** Verificar que las 5 métricas custom existen en el registry.

**Cómo:**
- Obtener `await registry.getMetricsAsJSON()`.
- Verificar que existen entradas con nombres: `mipit_payments_total`, `mipit_payment_latency_ms`, `mipit_translation_errors_total`, `mipit_routing_decisions_total`, `mipit_idempotency_hits_total`.

---

## Test 2: `paymentCounter` es Counter con labels correctos

**Objetivo:** Verificar tipo y label names del counter de pagos.

**Cómo:**
- Verificar que `paymentCounter` tiene `labelNames` que incluye `status`, `origin_rail`, `destination_rail`.

---

## Test 3: `paymentLatency` tiene los buckets del ticket

**Objetivo:** Verificar que el histograma usa los buckets especificados.

**Cómo:**
- Inspeccionar la métrica desde el registry o directamente el output de `registry.metrics()`.
- Verificar que los boundaries incluyen `5, 10, 25, 50, 100, 250, 500, 1000, 2500`.

---

## Test 4: `recordPayment` incrementa el counter

**Objetivo:** Verificar que el helper incrementa con los labels correctos.

**Cómo:**
- Llamar `recordPayment('COMPLETED', 'PIX', 'SPEI')`.
- Obtener el valor del counter con `paymentCounter.get()`.
- Verificar que hay un valor con `labels: { status: 'COMPLETED', origin_rail: 'PIX', destination_rail: 'SPEI' }` y `value: 1`.

---

## Test 5: `recordLatency` registra observación

**Objetivo:** Verificar que el helper registra la duración en el histograma.

**Cómo:**
- Llamar `recordLatency('TRANSLATE', 42)`.
- Obtener el valor del histograma con `paymentLatency.get()`.
- Verificar que la suma incluye 42 y el count es 1 para el label `stage: 'TRANSLATE'`.

---

## Test 6: `startLatencyTimer` mide duración automática

**Objetivo:** Verificar que el timer captura tiempo transcurrido.

**Cómo:**
- Llamar `const stop = startLatencyTimer('ROUTE')`.
- Esperar brevemente (ej: `await new Promise(r => setTimeout(r, 10))`).
- Llamar `stop()`.
- Verificar que el histograma tiene una observación > 0 para `stage: 'ROUTE'`.

---

## Test 7: `recordIdempotencyHit` incrementa sin labels

**Objetivo:** Verificar que el counter de idempotencia incrementa correctamente.

**Cómo:**
- Llamar `recordIdempotencyHit()` dos veces.
- Verificar que `idempotencyHits.get()` muestra un valor de 2.

---

## Test 8: Default metrics están habilitadas

**Objetivo:** Verificar que `collectDefaultMetrics` registró métricas de proceso.

**Cómo:**
- Obtener `await registry.getMetricsAsJSON()`.
- Verificar que existe una métrica con nombre `process_cpu_seconds_total` o `nodejs_eventloop_lag_seconds`.

---

---

# Tests Unitarios — `src/persistence/repositories/idempotency.repository.ts`

Archivo de test sugerido: `test/unit/persistence/idempotency.repository.test.ts`

## Estrategia general

Mockear `Pool` de `pg` con un `db.query` jest function. Mockear `../../observability/logger.js` para verificar llamadas a `logger.debug`. Instanciar `IdempotencyRepository` con el pool mockeado.

---

## Test 1: `findByKey` retorna null si la key no existe

**Objetivo:** Verificar que cuando no hay fila, el método retorna `null`.

**Cómo:**
- Mockear `db.query` para retornar `{ rows: [] }`.
- Llamar `repo.findByKey('nonexistent')`.
- Verificar que retorna `null`.

---

## Test 2: `findByKey` retorna el record cuando existe

**Objetivo:** Verificar que retorna un `IdempotencyRecord` correcto.

**Cómo:**
- Mockear `db.query` para retornar `{ rows: [{ idempotency_key: 'key1', payment_id: 'PMT-1', request_hash: 'abc', ... }] }`.
- Llamar `repo.findByKey('key1')`.
- Verificar que el objeto retornado tiene los campos correctos.

---

## Test 3: `findByKey` usa la query con filtro de expiración

**Objetivo:** Verificar que la query incluye `expires_at > NOW()`.

**Cómo:**
- Llamar `repo.findByKey('key1')`.
- Verificar que `db.query` fue llamado con el primer argumento que contiene `expires_at > NOW()`.

---

## Test 4: `insert` pasa los 6 parámetros incluyendo `payment_id`

**Objetivo:** Verificar que el INSERT incluye `payment_id` en la posición correcta.

**Cómo:**
- Llamar `repo.insert({ idempotency_key: 'k1', payment_id: 'PMT-1', request_hash: 'hash', created_at: '2025-...' })`.
- Verificar que `db.query` recibe un array de 6 elementos donde el segundo es `'PMT-1'`.

---

## Test 5: `insert` serializa `response_body` como JSON

**Objetivo:** Verificar que un body objeto se pasa como `JSON.stringify`.

**Cómo:**
- Pasar `response_body: { id: 'test' }` en el record.
- Verificar que el parámetro 5 del query es `'{"id":"test"}'`.

---

## Test 6: `insert` pasa null si `response_body` es undefined

**Objetivo:** Verificar que sin body, se pasa `null` al query.

**Cómo:**
- Pasar un record sin `response_body`.
- Verificar que el parámetro 5 es `null`.

---

## Test 7: `updateResponse` serializa body y pasa status

**Objetivo:** Verificar que los parámetros se pasan en el orden correcto.

**Cómo:**
- Llamar `repo.updateResponse('key1', 202, { payment_id: 'PMT-1' })`.
- Verificar que `db.query` recibe `[202, '{"payment_id":"PMT-1"}', 'key1']`.

---

## Test 8: Logging en cada método

**Objetivo:** Verificar que `logger.debug` es llamado con los campos contextuales correctos.

**Cómo:**
- Llamar cada método (`findByKey`, `insert`, `updateResponse`).
- Verificar que `logger.debug` fue llamado con:
  - `findByKey`: `{ idempotency_key, found }` y mensaje `'Idempotency lookup'`.
  - `insert`: `{ idempotency_key, payment_id }` y mensaje `'Idempotency key inserted'`.
  - `updateResponse`: `{ idempotency_key, status }` y mensaje `'Idempotency response cached'`.

---

---

# Tests Unitarios — `src/persistence/repositories/route-rule.repository.ts`

Archivo de test sugerido: `test/unit/persistence/route-rule.repository.test.ts`

## Estrategia general

Mockear `Pool` de `pg` con un `db.query` jest function. Mockear `../../observability/logger.js` para verificar llamadas a `logger.debug`. Instanciar `RouteRuleRepository` con el pool mockeado.

---

## Test 1: `findActive` retorna reglas ordenadas por prioridad

**Objetivo:** Verificar que `findActive()` retorna las filas del query como `RouteRule[]`.

**Cómo:**
- Mockear `db.query` para retornar 3 filas con prioridades distintas.
- Verificar que el SQL usado incluye `ORDER BY priority ASC`.
- Verificar que retorna las 3 filas.

---

## Test 2: `findActive` retorna array vacío si no hay reglas activas

**Objetivo:** Verificar que sin filas, retorna `[]`.

**Cómo:**
- Mockear `db.query` con `{ rows: [] }`.
- Verificar que retorna un array vacío.

---

## Test 3: `findActive` usa `is_active` (no `active`) en la query

**Objetivo:** Verificar que la query corregida filtra por la columna real.

**Cómo:**
- Llamar `findActive()`.
- Verificar que `db.query` fue llamado con un SQL que contiene `is_active = true`.

---

## Test 4: `findById` retorna la regla cuando existe

**Objetivo:** Verificar que retorna un `RouteRule` correcto.

**Cómo:**
- Mockear `db.query` con una fila `{ id: 1, rule_name: 'pix_key_to_pix', condition_field: 'alias.type', ... }`.
- Llamar `repo.findById(1)`.
- Verificar que los campos retornados coinciden.

---

## Test 5: `findById` retorna null cuando no existe

**Objetivo:** Verificar que sin fila, retorna `null`.

**Cómo:**
- Mockear `db.query` con `{ rows: [] }`.
- Llamar `repo.findById(999)`.
- Verificar que retorna `null`.

---

## Test 6: `findById` acepta number, no string

**Objetivo:** Verificar que el parámetro se pasa como número.

**Cómo:**
- Llamar `repo.findById(1)`.
- Verificar que `db.query` recibe `[1]` (no `['1']`).

---

## Test 7: Logging en ambos métodos

**Objetivo:** Verificar que `logger.debug` es llamado con los campos contextuales correctos.

**Cómo:**
- Llamar `findActive()`: verificar log con `{ count: N }` y mensaje `'Loaded active route rules'`.
- Llamar `findById(1)`: verificar log con `{ id: 1, found: true/false }` y mensaje `'Route rule lookup'`.

---

## Test 8: `RouteRule` interface tiene los campos del schema

**Objetivo:** Verificar type-safety con un objeto que use los campos reales de la tabla.

**Cómo:**
- Crear un objeto `const rule: RouteRule = { id: 1, rule_name: 'test', condition_field: 'alias.type', condition_value: 'PIX_KEY', destination_rail: 'PIX', priority: 1, is_active: true, created_at: '...' }`.
- Verificar que compila sin error y que no tiene campos del modelo viejo (`name`, `active`, `origin_rail`, etc.).

---

---

# Tests Unitarios — `src/persistence/repositories/mapping.repository.ts`

Archivo de test sugerido: `test/unit/persistence/mapping.repository.test.ts`

## Estrategia general

Mockear `Pool` de `pg` con un `db.query` jest function. Mockear `../../observability/logger.js` para verificar llamadas a `logger.debug`. Instanciar `MappingRepository` con el pool mockeado.

---

## Test 1: `findByRail` retorna entries filtradas por rail y direction

**Objetivo:** Verificar que `findByRail` pasa ambos parámetros al query.

**Cómo:**
- Mockear `db.query` para retornar 3 filas de tipo `MappingEntry`.
- Llamar `repo.findByRail('PIX', 'TO_CANONICAL')`.
- Verificar que `db.query` fue llamado con `[rail, direction]` = `['PIX', 'TO_CANONICAL']`.
- Verificar que retorna las 3 filas.

---

## Test 2: `findByRail` retorna array vacío si no hay mappings

**Objetivo:** Verificar que sin filas, retorna `[]`.

**Cómo:**
- Mockear `db.query` con `{ rows: [] }`.
- Llamar `repo.findByRail('UNKNOWN', 'TO_CANONICAL')`.
- Verificar que retorna `[]`.

---

## Test 3: `findByRail` usa `rail` e `is_active` (no `source_rail`/`active`)

**Objetivo:** Verificar que la query corregida filtra por las columnas reales.

**Cómo:**
- Llamar `repo.findByRail('PIX', 'TO_CANONICAL')`.
- Verificar que `db.query` fue llamado con un SQL que contiene `rail = $1 AND direction = $2 AND is_active = true`.

---

## Test 4: `findAll` retorna todas las entries activas

**Objetivo:** Verificar que `findAll` retorna el resultado completo.

**Cómo:**
- Mockear `db.query` con 5 filas mixtas (PIX/SPEI, TO_CANONICAL/FROM_CANONICAL).
- Llamar `repo.findAll()`.
- Verificar que retorna las 5 filas.

---

## Test 5: `findAll` usa `is_active` en la query

**Objetivo:** Verificar que la query filtra por `is_active = true`.

**Cómo:**
- Llamar `repo.findAll()`.
- Verificar que el SQL contiene `is_active = true`.

---

## Test 6: Logging en ambos métodos

**Objetivo:** Verificar que `logger.debug` es llamado con los campos contextuales correctos.

**Cómo:**
- `findByRail`: verificar log con `{ rail, direction, count }` y mensaje `'Loaded mapping entries'`.
- `findAll`: verificar log con `{ count }` y mensaje `'Loaded all mapping entries'`.

---

## Test 7: `MappingEntry` interface tiene los campos del schema

**Objetivo:** Verificar type-safety con un objeto que use los campos reales de la tabla.

**Cómo:**
- Crear `const entry: MappingEntry = { id: 1, rail: 'PIX', direction: 'TO_CANONICAL', source_field: 'valor', target_field: 'amount.value', transformation: 'parse_decimal', is_active: true, created_at: '...' }`.
- Verificar que compila sin error y que no tiene campos del modelo viejo (`source_rail`, `canonical_field`, `transform`, `active`).

---

## Test 8: `findByRail` diferencia TO_CANONICAL y FROM_CANONICAL

**Objetivo:** Verificar que se pueden hacer llamadas con diferentes directions.

**Cómo:**
- Llamar `repo.findByRail('PIX', 'TO_CANONICAL')` y `repo.findByRail('PIX', 'FROM_CANONICAL')`.
- Verificar que `db.query` fue llamado 2 veces con `['PIX', 'TO_CANONICAL']` y `['PIX', 'FROM_CANONICAL']` respectivamente.

---

## Dependencias para tests

- `pg` (ya instalado, se mockea)
- `pino` (ya instalado)
- `prom-client` (ya instalado)
- `jest` + `ts-jest` (ya configurados en devDependencies)
- `@opentelemetry/api` (ya instalado como transitiva)

No se necesitan dependencias adicionales.
