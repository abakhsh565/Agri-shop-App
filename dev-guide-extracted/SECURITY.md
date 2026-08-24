# Security Baseline

## Objective
Secure-by-design application. No system can be guaranteed unhackable; the goal is to minimize attack surface, enforce least privilege, protect data, and detect/respond to abuse.

## Identity
- Secure authentication.
- Short-lived access tokens with secure refresh lifecycle.
- Modern password hashing if passwords are used.
- Session/token revocation.
- Admin and Employee roles.

## Authorization
Enforce permissions server-side for every protected operation. Never rely on UI visibility.

Admin-only:
- supplier financials
- purchase/base cost
- gross profit
- product/price management
- stock-in
- inventory adjustments
- employee administration
- administrative controls

Employee:
- sales
- customer operations
- customer financial history as allowed by PRD
- operational dashboard

Employees must not receive supplier financials, purchase cost, profit, product management, price management, or stock adjustments.

## Secrets
- No secrets in source control.
- No privileged credentials in the mobile app.
- Use environment variables/secret manager.
- Rotate compromised credentials.
- Separate development, staging, and production credentials.

## API
- TLS everywhere outside local development.
- Strict input validation.
- Authentication and authorization.
- Rate limiting.
- Payload limits.
- Secure error responses.
- Audit sensitive operations.
- API versioning.
- Narrow CORS where applicable.

## Data
- Encrypt in transit.
- Use platform/infrastructure encryption at rest.
- Least-privilege database credentials.
- Backups and restore testing.
- Do not log secrets/tokens or unnecessary sensitive customer/financial data.

## Mobile
- HTTPS.
- Secure OS credential storage.
- No API secrets.
- Minimize production logs.
- Validate deep links/external input.
- Consider certificate pinning and device-compromise controls based on threat model.

## Business Security
Server calculates authoritative:
- sale totals
- payment amounts
- outstanding balances
- inventory changes
- prices
- profit
- permissions
- return eligibility

Client values are untrusted.

## Audit
Record sensitive actions including security events, inventory adjustments, returns, payments, employee activation/deactivation, product/price changes, and other important admin actions.
