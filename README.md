# mipit-core

> Core middleware for the MiPIT PoC — Unified API + Translation + Normalization + Routing + Persistence + RabbitMQ publishing.

## Architecture

```
UI → mipit-core → translate/normalize/route → RabbitMQ → adapters → ack → mipit-core → UI
```

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Run in development mode
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

## Project Structure

| Directory | Purpose |
|---|---|
| `src/api/` | Fastify server, routes, middleware, request/response schemas |
| `src/config/` | Environment validation (Zod), constants |
| `src/domain/` | Domain models (PaymentIntent, Canonical, RouteRule) and errors |
| `src/canonical/` | ISO 20022 pacs.008 / pacs.002 Zod schemas |
| `src/translation/` | Rail-specific ↔ Canonical translation logic |
| `src/normalization/` | Date, currency, ID, and fallback normalization rules |
| `src/routing/` | Rule-based routing engine |
| `src/messaging/` | RabbitMQ connection, publisher, ACK consumer |
| `src/persistence/` | PostgreSQL pool, repositories, SQL queries |
| `src/pipeline/` | Payment pipeline orchestrator |
| `src/audit/` | Audit trail service |
| `src/observability/` | OpenTelemetry, Prometheus metrics, Pino logger |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/payments` | Create a new payment intent |
| `GET` | `/payments/:id` | Get payment details |
| `GET` | `/health` | Health check |
| `GET` | `/metrics` | Prometheus metrics |

## Environment Variables

See `.env.example` for all required configuration.

## License

MIT
