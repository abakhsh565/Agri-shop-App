# Technical Architecture — Baseline

## 1. Objective
Build a secure, maintainable, scalable, cloud-portable application for iOS and Android with a single mobile codebase and a backend that owns all authoritative business rules.

## 2. Recommended Stack
### Mobile
Flutter + Dart.

### Backend
TypeScript + NestJS, starting as a modular monolith.

### Database
PostgreSQL.

### Cache / transient coordination
Redis when required for rate limiting, caching, queues, or short-lived state.

### API
HTTPS JSON API, versioned under `/api/v1`, with OpenAPI documentation.

### Object storage
Private S3-compatible object storage for logos/attachments if required.

### AI/LLM
Provider abstraction behind the backend if AI features are added. Mobile must never call privileged LLM APIs directly.

### Infrastructure
Containerized deployment and environment-specific configuration. Keep business logic provider-neutral.

## 3. Logical Architecture
Mobile Client
→ API / Backend
→ Authentication & Authorization
→ Domain/Application Services
→ Repositories
→ PostgreSQL

Supporting services:
- Redis
- Object storage
- Background worker/queue
- AI provider abstraction
- Observability

## 4. Principles
- Server authoritative for business rules.
- UI is not a security boundary.
- Modular monolith first; extract services only when justified.
- Strongly typed API contracts.
- Explicit domain boundaries.
- Immutable transaction history.
- Auditable stock movement.
- Least privilege.
- Cloud portability.
- Testability.
- Backward-compatible API evolution.

## 5. Domain Modules
1. Authentication
2. Users / Employees
3. Companies / Suppliers
4. Products
5. Product Variants / Units
6. Inventory
7. Purchases / Stock-In
8. Supplier Payables
9. Customers
10. Sales
11. Customer Payments / Credit
12. Returns
13. Inventory Adjustments
14. Dashboards / Reporting
15. Settings / Configuration
16. Audit / Activity

## 6. Critical Transaction Boundary
Related financial and inventory changes must be atomic.

Example sale:
validate permission → validate stock/sellability → calculate totals server-side → create sale + lines + payment/outstanding state + stock movement in one database transaction → commit.

## 7. Mobile Structure
Feature-based modular structure:
- core/
- auth/
- dashboard/
- sales/
- customers/
- products/
- inventory/
- suppliers/
- purchases/
- employees/
- payments/
- reports/
- settings/

Separate presentation/UI, application state/use-cases, domain models, and data/API layers.

## 8. Backend Structure
Use modular NestJS modules. Controllers remain thin; application/domain services own use cases; repositories own persistence concerns.

## 9. Extensibility
Current inventory should be represented through a sellable product/variant concept so future batch-level expiry can be added without rewriting sales. Do not implement full batch costing in MVP without approval.

## 10. Portability
Keep cloud-specific, AI-provider-specific, and payment-provider-specific adapters behind interfaces. Do not couple core business logic to one vendor.
