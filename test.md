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

## Dependencias para tests

- `pino` (ya instalado)
- `jest` + `ts-jest` (ya configurados en devDependencies)
- `@opentelemetry/api` (ya instalado como transitiva)

No se necesitan dependencias adicionales.
