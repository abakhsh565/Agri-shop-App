# Authentication & Session — Agri Shop Management System

Full auth logic, all flows, edge cases, and screen states.
No passwords. No email. Phone + OTP only.

---

## Auth Method

- **Identifier:** Phone number (local format, e.g. 03xxxxxxxxx)
- **Verification:** OTP — 6-digit code via SMS
- **No email required anywhere**
- **No self-registration for employees**
- **Session persistence:** OTP only required on first login per device. After verification, session persists until explicit logout, reinstall, or new device.

---

## User Roles

| Role | Created By | Permissions |
|---|---|---|
| Admin / Owner | Self-signup | Full access. Only original Owner cannot be demoted or removed |
| Co-Admin | Owner or existing Co-Admin | Same permissions as Owner except cannot remove/demote the original Owner |
| Employee | Admin or Co-Admin only (via Employees screen) | Sales + customer operations only |

---

## Flow 1 — Admin / Owner Signup (New Shop)

**Entry point:** "Create new shop" on the landing/login screen.

### Steps
1. Enter phone number
2. OTP sent to phone → enter OTP → verify
3. If phone already exists in system → show "This number is already registered. Log in instead." → redirect to login
4. Set shop name (text input, required)
5. Set 4-digit PIN (used for quick re-authentication on same device — NOT for OTP login)
6. Account created as Admin/Owner
7. Redirect to Admin dashboard (first-time empty state)

### Edge Cases
- OTP not received → "Resend OTP" available after 30 seconds; max 3 resend attempts per session
- OTP expired (validity: 5 minutes) → show "OTP expired. Request a new one." → resend flow
- OTP incorrect → show "Incorrect OTP. X attempts remaining." → block after 5 failed attempts for 10 minutes
- Phone already registered as Employee → "This number is registered as an employee. Log in as employee instead."
- Phone already registered as Admin → "This number already has an account. Log in instead."
- Shop name empty → inline validation: "Shop name is required"
- PIN less than 4 digits → inline validation: "PIN must be 4 digits"
- Network error during OTP send → "Could not send OTP. Check your connection and try again." + retry button

---

## Flow 2 — Admin / Co-Admin Login (Returning)

**Entry point:** "Log in" on the landing screen.

### Steps
1. Enter phone number
2. System checks: is this number registered?
   - Not found → show "Not registered" state (see Flow 5)
   - Found as deactivated → not applicable for Admin/Owner (Owners cannot be deactivated; Co-Admins can — see edge cases)
   - Found as active Admin/Co-Admin → proceed
3. **If device is recognized (session token valid):** skip OTP → enter PIN → granted access → Admin dashboard
4. **If device is new / session expired:** OTP sent → enter OTP → verify → enter PIN → granted access → Admin dashboard

### Edge Cases
- PIN forgotten → "Forgot PIN?" link → triggers OTP re-verification → set new PIN
- PIN incorrect → "Incorrect PIN. Try again." (no lockout on PIN — OTP is the real auth; PIN is convenience only)
- Co-Admin deactivated by Owner → OTP verify succeeds → system checks status → show "Access revoked. Contact the shop owner." → no entry
- Session on old device still active → new device login invalidates old session (single active session per user)
- Phone number changed → user must contact Owner to update; no self-service number change in MVP

---

## Flow 3 — Employee Login

**Entry point:** "Log in" on the landing screen (same as Admin flow — role detected after verification).

### Steps
1. Enter phone number
2. System checks: is this number registered?
   - Not found → show "Not registered" state (see Flow 5)
   - Found as deactivated Employee → proceed to OTP, then block (see below)
   - Found as active Employee → proceed
3. **If device is recognized:** skip OTP → enter PIN → granted access → Employee dashboard
4. **If device is new / session expired:** OTP sent → enter OTP → verify → enter PIN → granted access → Employee dashboard

### Edge Cases
- Employee exists but is deactivated:
  - OTP is still sent and can be verified (OTP does not know about deactivation)
  - After successful OTP, system checks `isActive` status
  - If deactivated: show "Your access has been revoked. Contact your shop admin." → no entry, no PIN step
- Employee phone number not in system: show "Not registered" state (see Flow 5)
- Employee tries to access Admin routes directly: redirect to Employee dashboard with no error (role-based route guard)
- PIN forgotten: same "Forgot PIN?" → OTP re-verify → set new PIN flow

---

## Flow 4 — Employee Added by Admin (No Self-Registration)

Employees have no signup flow. Admin/Co-Admin adds them from the Employees screen.

### Admin adds Employee
1. Admin → Employees → Add Employee
2. Inputs: Name, Phone Number, (optional) notes
3. System registers the phone number as an Employee account (inactive until first login)
4. No PIN set at this point — Employee sets their own PIN on first login
5. Admin can optionally notify the employee manually (no in-app SMS notification in MVP)

### Employee first login after being added
1. Employee enters their phone number on the login screen
2. OTP sent → verify
3. System detects: first login (no PIN set) → prompt to set a 4-digit PIN
4. PIN set → Employee dashboard

### Edge Cases
- Admin enters a phone number that already exists as another Employee → "This number is already registered as an employee."
- Admin enters a phone number that already exists as Admin/Co-Admin → "This number belongs to an admin account."
- Admin enters duplicate phone number → inline error before save
- Employee's phone number is changed by Admin (future): Admin edits the employee record; old number loses access; employee must log in with new number

---

## Flow 5 — Unregistered Phone Number

Triggered when a phone number is not found in the system during login.

### Screen state
- Message: "This number isn't registered with any shop."
- Sub-message: "If you're an employee, contact your shop admin to get access."
- Button: "Create a new shop" (leads to Admin signup — Flow 1)
- **No "Sign up as employee" option exists anywhere**

### Edge Cases
- User types wrong number → allow them to go back and re-enter
- User thinks they're registered but aren't → only option is to contact Admin or create new shop

---

## Flow 6 — Co-Admin Management

### Promote Employee to Co-Admin
1. Admin → Employees → Select Employee → "Promote to Co-Admin"
2. Confirmation dialog: "This will give [Name] admin-level access. Confirm?"
3. On confirm: role updated to `co_admin`
4. Co-Admin retains their existing phone/PIN — no re-registration needed

### Add New Co-Admin (not existing Employee)
1. Admin → Employees → Add Co-Admin
2. Enter phone number
3. If number exists as Employee → promote (same as above)
4. If number is new → register as Co-Admin directly (no Employee step)
5. New Co-Admin logs in via normal flow (OTP + PIN setup on first login)

### Co-Admin Restrictions
- Cannot remove or demote the original Owner (identified by `isOriginalOwner: true` flag)
- Can deactivate other Employees and Co-Admins
- Can add new Employees and Co-Admins
- All other permissions are identical to Owner/Admin

### Edge Cases
- Co-Admin tries to deactivate Owner → action blocked, show "Cannot deactivate the shop owner."
- Co-Admin tries to promote themselves to Owner → not possible (Owner flag is permanent)
- Two Co-Admins simultaneously deactivating each other → last-write wins; system allows; Owner can reactivate

---

## Flow 7 — Session Management

### First login on a device
- OTP verification required
- PIN set (if first ever login) or PIN entered (returning user on new device)
- Session token stored on device (secure storage)
- Session does not expire passively — stays active until explicit logout, reinstall, or new device login

### Returning login on same device
- Phone number entered (or remembered) → PIN only → granted access
- OTP not required

### Session lock (in-app)
- After inactivity timeout (configurable in Settings, default: 15 minutes)
- App shows PIN entry screen (not full login)
- Correct PIN → resume session
- "Not you?" link → full logout → login screen

### Logout
- Explicit logout clears session token from device
- Next login on same device requires OTP + PIN again

### New device / reinstall
- Session token not present → full OTP + PIN flow required

### Edge Cases
- User loses phone → no remote session invalidation in MVP; Owner can deactivate the account as a workaround
- Multiple devices: system supports single active session per user in MVP; new device login invalidates previous session token
- App crash during PIN setup: PIN not saved; next launch re-triggers PIN setup step
- Biometric / Face ID: not in MVP scope

---

## Screen Inventory — Auth Screens

### AUTH-LANDING
The first screen seen by any user.

**States:**
1. Default → two actions: "Log in" + "Create new shop"
2. No internet → show offline banner; disable OTP-dependent actions

---

### AUTH-PHONE-ENTRY
Phone number input screen.

**States:**
1. Empty → input placeholder "03xxxxxxxxx", disabled submit button
2. Typing → real-time format validation (numeric, length)
3. Valid number entered → submit button active
4. Submitting → loading spinner on button, input disabled
5. Success → transition to OTP screen
6. Error: not registered → transition to "Not Registered" state
7. Error: network → inline error with retry

---

### AUTH-OTP-VERIFY
OTP entry screen.

**States:**
1. Default → 6-box OTP input, auto-focus first box, countdown timer (5:00)
2. Typing → auto-advance to next box on digit entry
3. Submitting → loading
4. Success → transition to PIN screen or dashboard
5. Error: wrong OTP → shake animation + "Incorrect code. X attempts left."
6. Error: expired → "OTP expired." + Resend button (no countdown)
7. Error: too many attempts (5) → "Too many attempts. Try again in 10 minutes." + disabled input
8. Resend available → "Resend OTP" link active after 30s countdown
9. Resend limit reached (3) → "Maximum resends reached. Try again later."
10. Back → return to phone entry (OTP invalidated)

---

### AUTH-PIN-SET (First login / new device)
Set a 4-digit PIN.

**States:**
1. Default → "Set a 4-digit PIN" heading, 4 dot inputs
2. PIN entered → confirm PIN step appears
3. Confirm match → success → proceed to dashboard or shop setup
4. Confirm mismatch → "PINs don't match. Try again." → clear both inputs
5. All same digits (e.g. 1111) → allowed (no complexity rules in MVP)

---

### AUTH-PIN-ENTRY (Returning user, same device)
Enter existing PIN.

**States:**
1. Default → "Enter your PIN" + 4 dot inputs + phone number shown (greyed)
2. Incorrect → "Incorrect PIN." (no lockout)
3. "Forgot PIN?" → OTP re-verification flow → PIN reset
4. "Not you?" → logout + AUTH-PHONE-ENTRY

---

### AUTH-SHOP-SETUP (Admin first login only)
Set shop name after OTP verification.

**States:**
1. Default → "Shop name" input + "Continue" button
2. Empty submit → inline error "Shop name is required"
3. Success → AUTH-PIN-SET → Admin dashboard (empty state)

---

### AUTH-NOT-REGISTERED
Shown when phone number is not in system.

**States:**
1. Default → message + "Create a new shop" button
2. No "Sign up as employee" option (ever)

---

### AUTH-DEACTIVATED
Shown after OTP verify succeeds but account is deactivated.

**States:**
1. Employee deactivated → "Your access has been revoked. Contact your shop admin."
2. Co-Admin deactivated → same message
3. No retry or workaround option shown — contact admin only

---

### AUTH-SESSION-LOCKED
In-app lock screen after inactivity.

**States:**
1. Default → user name shown, PIN input, "Not you?" link
2. Correct PIN → resume
3. "Not you?" → full logout

---

## Data Stored Per User (Auth-relevant)

```ts
interface User {
  id: string
  name: string
  phone: string                  // unique identifier
  role: 'admin' | 'co_admin' | 'employee'
  isOriginalOwner: boolean       // true only for the first Admin who created the shop
  pin: string                    // hashed
  isActive: boolean
  firstLoginAt: string | null    // ISO datetime — null until first successful login
  lastLoginAt: string | null
  deactivatedAt: string | null
  deactivatedBy: string | null   // FK → User (Admin/Co-Admin who deactivated)
  createdAt: string
  createdBy: string | null       // null for self-registered Admin; FK → User for others
}
```

---

## Role Hierarchy Summary

```
Owner (Admin, isOriginalOwner = true)
  └── Full access
  └── Cannot be deactivated or demoted by anyone

Co-Admin (role = 'co_admin')
  └── Same as Owner except:
       └── Cannot deactivate/demote original Owner

Employee (role = 'employee')
  └── Sales + customer ops only
  └── No self-registration
  └── Can be deactivated by Admin or Co-Admin
```

---

## Supabase Auth Integration Notes

- Use Supabase Phone Auth (OTP via SMS) for all verification
- After Supabase OTP verification, match phone number against `users` table
- Session token stored via Supabase `persistSession: true` on the client
- PIN is stored as a bcrypt hash in the `users` table — NOT in Supabase Auth
- PIN verification is done in app against the stored hash (not a second Supabase auth call)
- RLS policies enforce role-based data access at the database level
- `isOriginalOwner` flag set to `true` only on first user creation; immutable after

---

## Error Message Reference

| Scenario | Message Shown |
|---|---|
| Phone not registered | "This number isn't registered. If you're an employee, contact your shop admin." |
| Account deactivated | "Your access has been revoked. Contact your shop admin." |
| OTP incorrect | "Incorrect code. [X] attempts remaining." |
| OTP expired | "This code has expired. Request a new one." |
| OTP attempts exceeded | "Too many incorrect attempts. Try again in 10 minutes." |
| OTP resend limit | "Maximum resend attempts reached. Try again later." |
| Phone already registered (signup) | "This number already has an account. Log in instead." |
| Phone registered as other role (signup) | "This number is registered as an employee. Log in instead." |
| Duplicate phone (add employee) | "This number is already registered in the system." |
| Co-Admin tries to deactivate Owner | "The shop owner account cannot be deactivated." |
| Network error | "Connection failed. Check your internet and try again." |
| PIN mismatch (set PIN) | "PINs don't match. Please try again." |
| Shop name empty | "Shop name is required." |
