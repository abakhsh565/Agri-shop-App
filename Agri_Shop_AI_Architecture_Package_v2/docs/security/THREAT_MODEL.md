# Threat Model

## Assets
- User accounts
- Customer financial records
- Sales and payment records
- Supplier financial records
- Purchase/base costs
- Gross profit
- Inventory records
- Product/price data
- Uploaded logos/files
- API credentials
- Admin privileges
- Audit history

## Threats and Controls

### Account takeover
Secure authentication, token lifecycle, rate limiting, session revocation, optional MFA.

### Broken authorization / IDOR
Server-side resource and role checks on every protected operation. Never trust client-supplied identifiers alone.

### Privilege escalation
Centralized authorization policy and role-boundary tests.

### Price/cost manipulation
Server-side price/cost lookup and validation; employees cannot view or submit privileged cost fields.

### Inventory manipulation
Atomic transactions, non-negative stock invariant, audited adjustments, no silent changes.

### Financial history tampering
Append-only transaction history; corrections use reversal/return/adjustment mechanisms.

### API abuse
Rate limiting, validation, payload limits, monitoring.

### File upload abuse
Allowlisted types, size limits, private storage, malware scanning where applicable, safe filenames, access control.

### Prompt injection / AI abuse (future)
Isolate untrusted content, least-privilege tools, explicit tool permissions, output validation, no unrestricted database access.

### Data leakage
Role-based response shaping, least privilege, secure logs, encryption, audit controls.

### Injection attacks
Parameterized queries/ORM; no shell execution from untrusted input.

### Dependency/supply-chain risk
Lockfiles, automated vulnerability scanning, controlled dependency upgrades.

## Pre-Production Security Testing
- authentication tests
- authorization matrix tests
- rate-limit/abuse tests
- injection tests
- file-upload tests
- transaction integrity tests
- secret scanning
- dependency scanning
- security review / penetration testing
