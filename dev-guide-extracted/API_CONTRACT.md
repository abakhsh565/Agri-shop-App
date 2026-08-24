# API Contract — Baseline

API version: `/api/v1`

## Conventions
- JSON request/response.
- HTTPS in non-local environments.
- Consistent error envelope.
- Authentication via secure token lifecycle.
- Authorization enforced server-side.
- Pagination for lists.
- Explicit filtering/sorting.
- Idempotency considered for retryable financial operations.

## Endpoint Groups
### Auth
- POST /api/v1/auth/login
- POST /api/v1/auth/refresh
- POST /api/v1/auth/logout

### Employees
- GET/POST/PATCH /api/v1/employees
- POST /api/v1/employees/{id}/deactivate

### Companies
- GET/POST/PATCH /api/v1/companies

### Products
- GET/POST/PATCH /api/v1/products
- GET/POST/PATCH /api/v1/products/{id}/variants

### Inventory
- GET /api/v1/inventory
- POST /api/v1/inventory/adjustments

### Purchases
- GET/POST /api/v1/purchases

### Supplier Payments
- GET/POST /api/v1/companies/{id}/payments

### Customers
- GET/POST/PATCH /api/v1/customers
- GET /api/v1/customers/{id}/history

### Sales
- GET/POST /api/v1/sales
- GET /api/v1/sales/{id}

### Customer Payments
- POST /api/v1/customers/{id}/payments

### Returns
- POST /api/v1/sales/{id}/returns

### Reports
- GET /api/v1/reports/dashboard
- GET /api/v1/reports/profit
- GET /api/v1/reports/sales

## Contract Rule
Maintain an OpenAPI specification from the actual backend contract. Use generated or strongly typed clients where practical.

## Financial Operations
Sales, purchases, returns, payments and inventory adjustments must be protected against accidental duplicate submission and execute required state changes atomically.
