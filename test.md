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

## Dependencias para tests

- `pg` (ya instalado, se mockea)
- `pino` (ya instalado)
- `jest` + `ts-jest` (ya configurados en devDependencies)
- `@opentelemetry/api` (ya instalado como transitiva)

No se necesitan dependencias adicionales.
