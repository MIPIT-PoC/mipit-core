# Core Validation Suite

Esta carpeta contiene una validacion pragmatica del `mipit-core` pensada para dos escenarios:

- `local`: cuando el core corre en tu maquina y dependencias estan accesibles localmente
- `deployment`: cuando el core corre en `VM1` y los adapters/mocks en `VM2`

## Que valida

La suite intenta cubrir lo mas importante del core para tesis y demo:

- acceso basico: `health`, `metrics`, emision de JWT
- traduccion: catalogo de rieles, `translate`, `translate/preview`
- validacion: CLABE invalida, monto negativo, auth obligatoria
- comunicacion: pago feliz PIX, SSE, webhooks
- enrutamiento: origen SPEI, destino BRE_B
- idempotencia: replay y conflicto
- trazabilidad: detalle del pago, auditoria, timestamps, listado reciente
- carga ligera: lote concurrente de 5 requests
- observabilidad: analytics summary, circuit breakers, rate limits, reconciliation
- infraestructura opcional: Postgres, RabbitMQ y health de mocks remotos

## Archivos

- `run-core-validation.ts`: ejecuta los checks y genera JSON + Markdown
- `consolidate-core-validation.ts`: consolida varios reportes JSON en un solo Markdown
- `.env.validation.example`: plantilla de configuracion

## Preparacion

1. Copia `.env.validation.example` a `.env.validation`
2. Ajusta `API_PROTOCOL`, `API_HOST` y `PORT`
3. Si vas a validar infraestructura, completa `DATABASE_URL` y `RABBITMQ_URL`
4. Si quieres validar mocks remotos, completa `PIX_MOCK_URL`, `SPEI_MOCK_URL`, `BREB_MOCK_URL`

## Ejecucion

```bash
npm run validate:core
```

El script genera dos artefactos en `test/validation/results/`:

- `core-validation-<timestamp>.json`
- `core-validation-<timestamp>.md`
- `core-validation-trace-<timestamp>.log`

La traza `.log` deja evidencia detallada de:

- cada request y response HTTP
- payloads enviados y cuerpos recibidos
- polling de estados asincronos
- pasos de DB, RabbitMQ y mocks
- inicio, fin y error de cada check

## Consolidacion

Si corres la validacion varias veces, puedes consolidar todos los JSON asi:

```bash
npm run validate:core:consolidate
```

O con archivos especificos:

```bash
npm run validate:core:consolidate -- test/validation/results/core-validation-a.json test/validation/results/core-validation-b.json
```

## Recomendacion para despliegue

Para validacion del despliegue real, la mejor practica es correr esta suite dentro de `VM1`, porque desde ahi el core, Postgres y RabbitMQ son alcanzables sin friccion de red adicional.

## Resultado esperado

- si no hay fallos criticos, el despliegue esta funcional para demo y tesis
- si hay warnings, suelen indicar asincronia o capacidad parcial del entorno
- si hay `failed` criticos, no conviene cerrar la validacion sin revisarlos
