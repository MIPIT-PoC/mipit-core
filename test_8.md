# Tests Semana 8 — API HTTP y Middleware

## Resumen

| Suite | Archivo | Tests | Tipo |
|---|---|---|---|
| Auth Middleware | `test/unit/middleware/auth.test.ts` | 4 | Unit |
| Tracing Middleware | `test/unit/middleware/tracing.test.ts` | 5 | Unit |
| Idempotency Middleware | `test/unit/middleware/idempotency.test.ts` | 5 | Unit |
| Payment Schemas | `test/unit/api/payments.test.ts` | 8 | Unit |
| HTTP → Pipeline | `test/integration/http-pipeline.test.ts` | 13 | Integration |
| **Total S8** | | **35** | |

## Detalle

### Auth Middleware (4 tests)
- Request con jwtVerify que lanza error → 401 UNAUTHORIZED
- Mensaje de error incluido en respuesta 401
- Token válido (jwtVerify resuelve) → pasa sin llamar reply
- Valores no-Error lanzados → 401 con "Invalid token"

### Tracing Middleware (5 tests)
- Usa X-Trace-ID del header cuando se provee
- Genera ULID cuando X-Trace-ID no viene
- Response incluye header X-Trace-ID
- Propaga traceId a span activo de OpenTelemetry
- No lanza error cuando no hay span activo

### Idempotency Middleware (5 tests)
- Sin Idempotency-Key → pasa sin consultar repo
- Key existente con hash matching → retorna response cacheada
- Key existente con hash diferente → 409 IDEMPOTENCY_CONFLICT
- Key nueva → setea idempotencyKey y requestHash en request
- response_status null → default 202

### Payment Schemas (8 tests)
- Payload válido aceptado
- amount <= 0 rechazado
- Debtor alias vacío rechazado
- Currency default USD
- Purpose default P2P
- Currency con longitud incorrecta rechazada
- paymentAcceptedSchema valida respuesta
- paymentDetailSchema valida detalle completo

### HTTP → Pipeline Integration (13 tests)
- POST /payments con JWT válido → 201 con payment_id
- pipeline.execute recibe body parseado y context
- POST sin JWT → 401
- POST con JWT inválido → 401
- POST con body inválido → 400 VALIDATION_ERROR
- Response incluye X-Trace-ID del request
- Genera X-Trace-ID cuando no se provee
- Almacena registro de idempotency tras éxito
- Idempotency-Key duplicada → response cacheada (no re-procesa)
- GET /payments/:id → detalle con audit trail
- GET /payments/:id inexistente → 404
- GET requiere autenticación
- GET /health sin JWT → 200 (no requiere auth)
