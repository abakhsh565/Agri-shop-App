# Quick Alerts — triage, destinations and presentation

Quick Alerts on the admin Home screen is a **triage surface**. It shows at most three items, each
with one primary action. It does not duplicate the Action Center, the customer ledger, the
reminder log or any other module's records; it points at the screen that owns the record.

## Presentation rule

| What the user must do | Presentation | Why |
|---|---|---|
| Decide a money/credit exception (approve or reject a limit, grant a different amount) | **Full screen** | The decision needs the customer, current limit, requested amount, reason, requester and the owner's approved amount together. A sheet hides the evidence and makes a risky amount easy to confirm by accident. |
| Audit a credit override that already happened | **Full screen** | It is a record with approver, before/after limits, time and current exposure. The next action is to open the customer or mark the alert seen. |
| Review reminders sent today | **Full screen** (`Action Center → Follow-ups → Recently sent`) | The intent is verification of work already done: who was contacted, by which channel, and what is still due. A modal would hide the list. |
| Plan a harvest follow-up | **Full screen** (`Harvest reminders`) | The intent is a worklist: the crop window, farmers with outstanding credit, and the route to ready follow-ups. |
| Compose/send one reminder | **Bottom sheet** | One customer, one message, one channel. This is a contained action, not a record review. |
| Confirm a destructive/irreversible action | **Confirmation dialog** | Only the decision is needed; the surrounding record stays on screen. |
| View all alert categories | **Action Center** | The complete list of live signals and follow-ups already lives there. Home only ranks the top three. |

The rule in one sentence: **screens for records and decisions, sheets for one contained action,
dialogs for confirmation.**

## Home's three rows

Home ranks candidates by business consequence and shows the first three. The current candidates
come from the authoritative sources below.

| Candidate | Source of truth | Destination | Presentation |
|---|---|---|---|
| Pending credit-limit request | `credit_limit_requests` via `getCreditRequestsDB()` | One request → `/admin/alerts/credit-requests/:requestId`; several → Action Center critical | Full screen |
| Approved override that left a red account | `credit_limit_requests` + `customers` | `/admin/alerts/credit-overrides/:customerId` | Full screen |
| Credit accounts flagged red | `customers` + the same red test as Credit Overrides | `/admin/alerts/credit-overrides` | Full screen |
| Supplier payable | `companies.outstanding_payable` | `/admin/purchases/payments` | Full screen |
| Out-of-stock / low stock | products and the stock ledger | `/admin/alerts/inventory` | Full screen |
| Reminders due today | reminder engine | Action Center → Follow-ups → Ready | Full screen |
| Reminders sent today | `reminder_logs` | Action Center → Follow-ups → Recently sent | Full screen |
| Harvest season approaching | `business_settings.crops` + `customer_crops` + `customers` | `/admin/alerts/harvest` | Full screen |

## Record ownership

- A credit request is never copied onto Home. Home reads it and links to it; approving still goes
  through `approve_credit_limit_request_v3`, which writes the granted amount, approver, time and
  audit event.
- A reminder send is a `reminder_logs` row. Home counts rows, not scheduled occurrences, so
  "sent today" always means a customer was contacted.
- Harvest reminders are driven by the crop dates in `business_settings` and the crops attached to
  each customer. Home does not create a parallel season record.
- `src/lib/quickAlerts.ts` owns the shared red-account, harvest-window and sent-today
  calculations so Home and the destination screens cannot drift.
