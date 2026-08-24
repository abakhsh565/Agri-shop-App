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
- The Supabase **service-role key** (which bypasses RLS) must never appear in the mobile app or client-accessible code — it is used only inside trusted server-side contexts (Edge Functions), never shipped to devices.
- The Supabase **anon/public key** is expected to be present in the mobile app — this is normal for Supabase's model, and is safe *only because* RLS policies and RPC-only writes are the actual security boundary, not key secrecy. Treat "the anon key is public" as a design assumption to build around, not a leak to panic about.
- Rotate compromised credentials (especially the service-role key).
- Separate Supabase projects for development and production — never share credentials across environments.

## API
- TLS everywhere (Supabase provides this by default).
- Strict input validation inside every RPC/Edge Function.
- Authentication via Supabase Auth (Phone OTP); authorization via RLS + in-function role checks (defense in depth — check twice, not once).
- Rate limiting on OTP requests specifically (prevent SMS-bombing abuse) via Supabase Auth settings or an Edge Function guard.
- Payload limits on any file upload (logos/attachments).
- Secure error responses — RPC functions return generic error messages to the client; detailed errors go to server-side logs only.
- Audit sensitive operations via `AuditEvent` inserts inside the same transaction as the action.
- API versioning via function naming (`_v1`, `_v2`) per `API_CONTRACT.md`.

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
