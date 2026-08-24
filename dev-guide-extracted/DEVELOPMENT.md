# Development Workflow

## Environments
- local/development
- staging
- production

Production secrets must never be reused in development.

## CI Checks
At minimum:
- formatting/lint
- type checking
- unit tests
- integration/API tests
- migration validation
- secret scanning
- dependency vulnerability scanning
- mobile build checks
- backend build checks

## Deployment
- Reproducible builds.
- Environment-specific configuration.
- Controlled database migrations.
- Documented rollback procedure.

## Observability
Track API latency, error rate, mobile crashes, database health, queue health, authentication failures, and important business transaction failures.

Never log secrets or unnecessary sensitive financial/customer data.
