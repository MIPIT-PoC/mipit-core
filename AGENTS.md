# AGENTS.md

<purpose>
This repository implements the core middleware of MiPIT-PoC: the unified API, payment pipeline, canonical translation, normalization, routing engine, messaging (RabbitMQ), persistence, idempotency, and observability instrumentation.

It is responsible for:
- receiving payment requests via Fastify REST API (POST /payments, GET /payments/:id, GET /health, GET /metrics),
- validating and canonicalizing payments into an ISO 20022 pacs.008 JSON subset,
- normalizing heterogeneous data (dates, currencies, IDs, fallbacks),
- routing payments to the correct rail (PIX or SPEI) via a rule-based engine,
- translating canonical payloads to destination rail format,
- publishing messages to RabbitMQ for adapter consumption,
- consuming ACK messages from adapters to update payment status,
- enforcing idempotency via Idempotency-Key header (SHA-256 hashed),
- JWT authentication and X-Trace-ID propagation,
- persisting payments, audit events, and idempotency keys in PostgreSQL,
- exposing Prometheus metrics and OpenTelemetry traces.

Treat shipped code as the primary source of truth.
When code and documents disagree, prefer:
1. current repo implementation,
2. current architecture/design artifacts in mipit-docs,
3. current SRS,
4. project plan / older planning notes.
</purpose>

<project_scope>
This PoC core demonstrates orchestration, translation, and routing only.
It does NOT implement:
- real money movement or settlement,
- production rail integrations (adapters are separate repos),
- AML/KYC flows,
- production-grade regulatory compliance,
- HA/DR/SLA production operations.

Use synthetic data and mock/sandbox adapters only.
Do not expand scope beyond the PoC unless the user explicitly requests it.
</project_scope>

<instruction_priority>
- User instructions override default style, tone, and initiative preferences.
- Safety, honesty, privacy, and permission constraints do not yield.
- If a newer user instruction conflicts with an earlier one, follow the newer instruction.
- Preserve earlier instructions that do not conflict.
</instruction_priority>

<workflow>
  <phase name="clarify">
  - Before proposing changes, clarify which layer is affected:
    - API routes / middleware,
    - payment pipeline orchestration,
    - canonical translation (PIX↔Canonical, SPEI↔Canonical),
    - normalization rules,
    - routing engine / rule loader,
    - RabbitMQ publisher / ACK consumer,
    - persistence (repositories, queries),
    - observability (OTel, Pino, Prometheus metrics),
    - error handling / domain errors.
  - Clarify impact on adapter contracts (message format, routing keys).
  </phase>

  <phase name="research">
  - Inspect the current codebase before proposing changes.
  - Key files to check:
    - src/config/env.ts and src/config/constants.ts for configuration and enums,
    - src/domain/models/canonical.ts for the pacs.008 Zod schema,
    - src/pipeline/payment-pipeline.ts for the 7-step orchestration,
    - src/translation/ for mappers and translator,
    - src/routing/ for rule engine and rule loader,
    - src/messaging/ for RabbitMQ connection, publisher, consumer,
    - src/persistence/ for repositories and SQL queries,
    - src/api/ for routes, middleware, and server setup,
    - src/observability/ for OTel, logger, and metrics.
  - Validate against the PostgreSQL schema in mipit-infra.
  - Validate against RabbitMQ topology in mipit-infra.
  </phase>

  <phase name="plan">
  - Present a concrete plan covering all affected layers.
  - Include: API contract changes, canonical model changes, routing changes, persistence changes, messaging changes, observability changes.
  - Wait for explicit user approval before implementation.
  </phase>

  <phase name="implement">
  - Keep the 7-step pipeline as the central orchestration pattern.
  - Keep translation logic in src/translation/, routing in src/routing/, persistence in src/persistence/.
  - Keep route handlers thin: validate → invoke pipeline → map response.
  - Keep middleware focused: auth → tracing → idempotency → handler.
  - Use Zod for all runtime validation (env vars, request bodies, canonical model).
  - Use ULID for all generated IDs (payment_id, audit_event_id).
  - Use parameterized queries ($1, $2) — never string interpolation in SQL.
  </phase>

  <phase name="verify">
  - Run `npm run build` to verify TypeScript compilation.
  - Run `npm run lint` for code quality.
  - Run `npm test` for unit and integration tests.
  - For pipeline changes, verify the full flow: POST → pipeline → RabbitMQ → (adapter) → ACK → status update.
  - Check that audit events are created for each pipeline step.
  - Check that idempotency prevents duplicate processing.
  - Verify OTel traces appear in Jaeger and metrics in Prometheus.
  </phase>

  <phase name="document">
  - Update README.md when API endpoints, setup steps, or architecture change.
  - Update openapi/openapi.yaml when API contracts change.
  - Update .env.example when environment variables change.
  </phase>
</workflow>

<architecture_rules>
- The payment pipeline is the core orchestration: receive → validate → canonicalize → normalize → route → translate → publish.
- The ACK consumer closes the loop: consume → update status → update rail_ack → audit log.
- Canonical model (CanonicalPacs008) is the internal lingua franca — all rail-specific formats translate to/from it.
- Route rules are loaded from DB and cached; the engine evaluates them by priority.
- Mapping table drives field-level translation between canonical and rail formats.
- Idempotency is enforced at the HTTP middleware layer, not in the pipeline.
- Audit events track every state transition for full traceability.
- Correlation: payment_id (ULID) + trace_id (OTel/ULID) travel across all components.
</architecture_rules>

<backend_rules>
- Keep route handlers in src/api/routes/ thin: validate input, call pipeline, return response.
- Keep middleware in src/api/middleware/ focused on cross-cutting concerns.
- Keep domain models in src/domain/models/ as Zod schemas and TypeScript types.
- Keep domain errors in src/domain/errors/ as typed AppError subclasses.
- Keep SQL queries as constants in src/persistence/queries/index.ts.
- Keep repositories in src/persistence/repositories/ as classes with pool injection.
- Keep translation functions pure where possible (canonical ↔ rail payload).
- Keep normalization rules in separate files under src/normalization/rules/.
- Keep RabbitMQ topology assertion in src/messaging/rabbitmq.ts.
- Keep bootstrap order in src/index.ts: OTel → DB → RabbitMQ → Server → AckConsumer → Listen.
</backend_rules>

<observability_rules>
- Structured JSON logging via Pino (src/observability/logger.ts).
- OTel SDK auto-instruments HTTP, Fastify, pg, amqplib (src/observability/otel.ts).
- 5 Prometheus metrics defined in src/observability/metrics.ts.
- Expose /metrics endpoint for Prometheus scraping.
- Propagate trace_id through RabbitMQ message headers.
- Log payment_id and trace_id in every log statement within the pipeline.
</observability_rules>

<testing_rules>
- Unit tests go in test/unit/ organized by module.
- Integration tests go in test/integration/.
- Use Jest with ts-jest for all tests.
- Mock external dependencies (DB, RabbitMQ) in unit tests.
- Use real DB in integration tests when possible.
- Test translation round-trips: PIX→Canonical→PIX should preserve data.
- Test routing rules against known aliases and country codes.
- Test idempotency: same key → cached response, different body → 409.
</testing_rules>

<default_commands>
- Development: `npm run dev` (tsx watch)
- Build: `npm run build` (tsc)
- Start: `npm start` (node dist/index.js)
- Lint: `npm run lint`
- Format: `npm run format`
- Test: `npm test`
- Test watch: `npm run test:watch`
- Test coverage: `npm run test:coverage`
</default_commands>
