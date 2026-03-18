# Tests Semana 7 — Pipeline, Consumer y Messaging

## Resumen

| Suite | Archivo | Tests | Estado |
|---|---|---|---|
| PaymentPipeline (unit) | `test/unit/pipeline/payment-pipeline.test.ts` | 11 | ✅ |
| AckConsumer (unit) | `test/unit/messaging/consumer.test.ts` | 11 | ✅ |
| Pipeline (integration) | `test/integration/pipeline.test.ts` | 9 | ✅ |
| Messaging (integration) | `test/integration/messaging.test.ts` | 9 | ✅ |
| **Total nuevos S7** | | **40** | ✅ |

---

## CORE-028 — Unit tests PaymentPipeline

### Archivo: `test/unit/pipeline/payment-pipeline.test.ts`

**Mocks:** Translator, Normalizer, RouteEngine, Publisher, PaymentRepository, AuditService, Logger (child)

**Tests:**
1. `execute() con PIX request válido → retorna payment_id y status QUEUED`
2. `execute() infiere rail PIX para alias 'PIX-xxx'`
3. `execute() infiere rail SPEI para alias 'SPEI-xxx'`
4. `execute() lanza error para alias desconocido`
5. `execute() llama translator.toCanonical con rail y payload correctos`
6. `execute() llama normalizer.normalize con canonical`
7. `execute() llama routeEngine.resolve y publisher.publishToAdapter con destino correcto`
8. `execute() llama paymentRepo.updateStatus(QUEUED) al final`
9. `execute() registra >= 4 audit events + 1 logRoutingDecision`
10. `execute() cuando translator falla → status FAILED + audit error + re-throw`
11. `execute() cuando routeEngine falla → status FAILED + re-throw`

---

## CORE-029 — Unit tests AckConsumer

### Archivo: `test/unit/messaging/consumer.test.ts`

**Mocks:** Channel (consume callback, ack, nack), PaymentRepository (updateAck), AuditService (log), Logger, Metrics (recordPayment)

**Tests:**
1. `start() registra consumer en queue payments.ack`
2. `procesa ACK ACCEPTED → paymentRepo.updateAck con COMPLETED`
3. `procesa ACK REJECTED → paymentRepo.updateAck con REJECTED`
4. `procesa ACK ERROR → paymentRepo.updateAck con FAILED`
5. `registra audit event con adapter_id y latency_ms`
6. `llama channel.ack(msg) después de procesar exitosamente`
7. `JSON inválido → nack sin requeue`
8. `error en paymentRepo.updateAck → nack sin requeue`
9. `mensaje sin payment_id → nack sin requeue`
10. `msg null → return sin procesar`
11. `registra métrica recordPayment después de procesar`

---

## CORE-030 — Integration tests

### Pipeline: `test/integration/pipeline.test.ts`

1. Pipeline completo PIX→SPEI → retorna QUEUED + destination SPEI
2. Pipeline completo SPEI→PIX → retorna destination PIX
3. Persiste pago con status RECEIVED en step 2
4. Actualiza canonical payload después de traducción (step 4)
5. Actualiza route y destination después de routing (step 6)
6. Publica mensaje y establece status QUEUED (step 7)
7. Lanza error para alias con prefijo desconocido
8. Translator falla → status FAILED + audit error
9. Registra >= 5 audit events (RECEIVED, VALIDATED, CANONICAL, ROUTE, STATUS_CHANGE)

### Messaging: `test/integration/messaging.test.ts`

**Publisher:**
1. Publica mensaje con routing key `route.pix` para PIX
2. Publica mensaje con routing key `route.spei` para SPEI
3. Establece persistent: true y contentType: application/json
4. Serializa mensaje como JSON Buffer

**AckConsumer:**
5. ACCEPTED → COMPLETED
6. REJECTED → REJECTED
7. ERROR → FAILED
8. Log audit con adapter_id y latency_ms
9. channel.ack después de procesar
