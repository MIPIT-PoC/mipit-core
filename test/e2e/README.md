# E2E Tests - Pragmatic Approach

## ¿Qué Validamos?

Estos tests E2E validan la arquitectura REAL de mipit-core contra servicios vivos:

```
HTTP GET/POST
    ↓
API Handler (routing.ts)
    ↓
Database Persistence
    ↓
RabbitMQ Publishing
    ↓
Async Message Consumption
```

## Requisitos Previos

```bash
# 1. PostgreSQL corriendo en localhost:5432
docker run -d --name postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:15

# 2. RabbitMQ corriendo en localhost:5672
docker run -d --name rabbitmq \
  -p 5672:5672 \
  -p 15672:15672 \
  rabbitmq:3

# 3. mipit-core API corriendo en localhost:3000
npm run dev  # En otra terminal

# 4. npm packages instalados
npm install
```

## Ejecutar Tests

```bash
# Todos los tests E2E
npm run test:e2e

# Test específico
npm test -- routing.test.ts

# Con verbose output
npm test -- routing.test.ts --verbose

# Con coverage
npm test -- routing.test.ts --coverage
```

## Estructura

```
test/e2e/
├── .env.test           # Configuración de ambiente para tests
├── fixtures.ts         # Shared utilities (DB, RabbitMQ, HTTP)
├── routing.test.ts     # Tests de routing + happy path
└── README.md           # Este archivo
```

## Lo Que Se Prueba

### API Acceptance ✓
- [x] HTTP 202 en pagos válidos
- [x] HTTP 400 en datos inválidos
- [x] Response contiene payment_id

### Persistence ✓
- [x] Pagos se guardan en DB
- [x] Status correcto (PENDING)
- [x] Moneda se persiste (BRL, MXN)
- [x] Cantidad es precisa (decimals)

### Routing ✓
- [x] BRL → PIX (Brasil a Brasil)
- [x] MXN → SPEI (México a México)
- [x] BRL→MXN → SPEI (Cross-border)

### Messaging ✓
- [x] Mensajes se publican a RabbitMQ
- [x] Trace ID se propaga
- [x] Message format es correcto

## Troubleshooting

### Error: Cannot connect to database
```bash
# Verificar PostgreSQL
docker ps | grep postgres

# Si no está corriendo:
docker run -d --name postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:15

# Esperar 5 segundos para inicializar
sleep 5
```

### Error: Cannot connect to RabbitMQ
```bash
# Verificar RabbitMQ
docker ps | grep rabbitmq

# Si no está corriendo:
docker run -d --name rabbitmq \
  -p 5672:5672 rabbitmq:3
```

### Error: Cannot connect to API
```bash
# 1. Verificar que API esté corriendo en otra terminal
npm run dev

# 2. Verificar que puerto 3000 está abierto
lsof -i :3000

# 3. Esperar 3 segundos para que API arranque
sleep 3
```

### Test timeout
```bash
# Aumentar timeout en jest.config.ts
testTimeout: 30000  // 30 segundos
```

## Análisis de Resultados

### ✅ Todas pasan
```
Test Suites: 1 passed, 1 total
Tests:       12 passed, 12 total
Time:        ~5s
```
→ Routing funciona, persistencia OK, messaging OK

### ⚠️ Algunas fallan
```
● E2E: Routing › Cross-Rail Scenario › should handle cross-border payment

Expected: 202
Received: 400
```
→ Ver error response en logs para detalles

### ❌ Fallan por timeout
```
Error: No message received in 5000ms
```
→ RabbitMQ no está corriendo o API no está publicando mensajes

## Próximas Fases (Cuando Estos Pasen ✓)

### Fase 2: Error Scenarios
- Bank rejections (NAO_REALIZADA, RECHAZADA)
- Timeout & retry logic
- Invalid data handling
- Compensation

### Fase 3: Idempotency & DLX
- Duplicate payment detection
- Dead Letter Queue routing
- State machine validation

### Fase 4: Advanced
- Field limits validation
- Rate limiting
- Account closure handling

## Quick Commands

| Necesito... | Comando |
|-----------|---------|
| Todos los E2E | `npm run test:e2e` |
| Routing test | `npm test -- routing.test.ts` |
| Con debug | `npm test -- routing.test.ts --verbose` |
| Ver DB | `docker exec postgres psql -U postgres -d mipit_test -c "SELECT * FROM payments LIMIT 5;"` |
| Ver RabbitMQ | `docker logs rabbitmq` |
| Ver API logs | Ver la otra terminal donde corre `npm run dev` |

## Consideraciones

1. **Tests son Integration, no Unit**
   - Requieren servicios reales (DB, RabbitMQ, API)
   - Más lentos pero más realistas

2. **Estado Compartido**
   - Cada test crea su propio payment_id
   - cleanup() elimina datos de test
   - Tests son independientes

3. **Timing**
   - Esperas: `setTimeout(1000)` para async processing
   - RabbitMQ consume: timeout 5 segundos
   - Jest timeout: 30 segundos

4. **Debugging**
   - Mostrar logs: `--verbose`
   - Ver payload: `console.log(JSON.stringify(payment, null, 2))`
   - Ver DB directo: `docker exec postgres psql -U postgres -d mipit_test`

---

**Status**: ✅ Ready to test
**Last Updated**: 2026-04-13
