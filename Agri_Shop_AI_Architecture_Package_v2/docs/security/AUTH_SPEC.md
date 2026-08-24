# Authentication & Authorization Spec

## Auth Method
Phone number + OTP for both Admin and Employee. No passwords, no email required, no self-registration for Employees.

## Roles
- **Owner (first Admin)** — created via signup, full access.
- **Co-Admin** — added by Owner, either by promoting an existing Employee or adding a new phone number directly. Same permissions as Owner, except cannot remove or demote the original Owner.
- **Employee** — added by Admin/Co-Admin only, via name + phone number. Cannot self-register.

## Signup / Login Flows

### Admin (Owner) Signup
```
Enter phone number → OTP sent → OTP verified → set shop name/PIN → account created as Owner
```

### Employee Creation (no self-signup)
```
Admin/Co-Admin → Employees → Add Employee → name + phone number → saved
```
The employee does not go through this flow themselves — it happens on the Admin's device.

### Employee Login
```
Install app → enter phone number → OTP sent → OTP verified
   → system checks number against registered employee list for this shop
       → found + active → enters Employee app
       → found + deactivated → "Access revoked — contact your shop admin"
       → not found → "Not registered — contact your shop admin" (no signup option offered)
```

### Co-Admin Creation
```
Owner → Employees/Admins → Add Co-Admin → promote existing employee OR add new phone number
   → OTP verification on that phone completes the Co-Admin's first login
```

## Session Behavior
- OTP required only on first login per device.
- Session persists after that; re-verification only triggered by reinstall or new device.
- Deactivation check happens at every login attempt, not just once at account level — a deactivated employee who still has the app installed must be blocked at login, not deeper in the app.

## Authorization Enforcement
- Enforced at the database layer via Row Level Security (RLS), not just hidden in the UI (per `AGENTS.md` Non-Negotiable Rules).
- Every RPC/Edge Function re-checks the caller's role internally, even though RLS is also in place — defense in depth, not either/or.
- Employees: RLS denies read access to supplier cost/payable columns and profit fields entirely — the query returns nothing for those fields, not just a hidden UI element.

## Secrets
- Supabase **anon/public key**: expected in the mobile app, safe because RLS + RPC-only writes are the real security boundary (see `SECURITY.md`).
- Supabase **service-role key**: never in the mobile app; server-side/Edge Function contexts only.
- No secrets in source control, ever.

## Open Decision — D18 (Product Owner Must Choose)
Supabase Phone Auth does not send SMS itself — it requires a connected third-party SMS provider (e.g. Twilio, MessageBird, Vonage). This has a small real cost per OTP sent (roughly $0.01–0.02/SMS depending on provider and country), which was not accounted for in the original "$0 budget" plan.

**Choose one before Phase 1 (Auth) begins:**

| Option | Cost | Trade-off |
|---|---|---|
| A. Phone + OTP via a paid SMS provider (Twilio etc.) | Small recurring cost (~$0.01–0.02/OTP × logins) | Matches the originally designed flow exactly; best UX for shop staff (no email needed). |
| B. Email + OTP instead of phone | Free (Supabase email auth has no per-message cost at this scale) | Requires every Admin/Employee to have and check an email — likely friction for shop floor staff in this context. |
| C. Phone + OTP, but only Admin/Co-Admin get SMS OTP; Employees get a PIN set by Admin instead | Near-$0 (only 1–2 SMS OTPs ever, for Admin/Co-Admin signup) | Deviates from the "phone+OTP for everyone" design already discussed; simpler and cheaper, but is a new decision, not just an implementation detail. |

Until this is marked LOCKED in `docs/DECISION_REGISTER.md` (D18), the AI coding agent should not begin Phase 1 Auth implementation — this is exactly the kind of ambiguity `AGENTS.md` requires flagging and stopping for, not guessing on.
