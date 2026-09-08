# EMPLOYEE ONBOARDING — DISCOVERY & GAP ANALYSIS

**Date:** September 9, 2026  
**Status:** DISCOVERY ONLY — No Implementation  
**Prepared by:** Buffy (Codebuff Agent)

---

# A. CURRENT SYSTEM — HOW IT WORKS TODAY

## Employee Data Storage

Employees are stored as rows in the **`users`** table — the same table used for all authentication.

```sql
users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  role user_role NOT NULL DEFAULT 'employee',  -- enum: admin, co_admin, employee
  is_original_owner BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  employee_number TEXT,  -- e.g., "EMP-001"
  job_title TEXT,
  photo_url TEXT,
  pin TEXT,  -- (planned: hashed PIN)
  first_login_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  deactivated_by UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  shop_id UUID NOT NULL REFERENCES shops(id),  -- tenant boundary
  created_at TIMESTAMPTZ DEFAULT now()
)
```

## Key Finding: Employee = User

There is **no separate employee table**. The `users` table serves dual purpose:
1. **Authentication identity** (login via phone + OTP)
2. **Application profile** (role, status, job title, etc.)

---

# B. CURRENT DATABASE MODEL

## Relevant Tables & Relationships

```
shops (id, name)
  └── users (shop_id) — all employees belong to a shop
       └── users.created_by — references the admin who created them

customers (created_by, shop_id)
products (created_by, shop_id)
sales (employee_id, employee_name, shop_id)
purchases (created_by, shop_id)
... (all business tables have shop_id for multi-tenancy)
```

## Multi-Tenancy Already Present

**Every business table has `shop_id`** from day one. The system is already tenant-ready:

| Table | Has shop_id | Has created_by |
|-------|-------------|----------------|
| users | ✅ | ✅ |
| customers | ✅ | ✅ |
| products | ✅ | ✅ |
| sales | ✅ | ❌ (has employee_id) |
| purchases | ✅ | ✅ |
| companies | ✅ | ✅ |
| All others | ✅ | ✅ |

---

# C. CURRENT AUTH MODEL

## Authentication Flow

```
Phone Entry → OTP Send → OTP Verify → User Lookup → Session Created
```

### Detailed Flow:

1. **Phone Entry:** User enters phone (03001234567)
2. **Normalization:** Converted to E.164 (923001234567)
3. **OTP Send:** Triggers Supabase Auth OTP (non-fatal if fails)
4. **OTP Verify:** Accepts hardcoded "123456" for MVP
5. **User Lookup:** `lookup_user_by_phone()` SECURITY DEFINER RPC
6. **Session:** User data stored in Zustand + localStorage (`agri_auth`)
7. **Supabase Auth:** JWT established for trusted identity

### Actor Identity in RPCs

```sql
-- RPCs use get_authenticated_user_id() to resolve actor
v_user_id := auth.uid();  -- From JWT
-- Then lookup app user by Supabase auth user
SELECT id INTO v_app_user_id FROM users WHERE id = v_user_id;
```

### Current Security Model

- **RLS:** Blocks direct anon writes (Phase 4 hardening)
- **RPCs:** SECURITY DEFINER, bypass RLS
- **Authorization:** Checked via `auth.uid()` → user lookup → role check
- **Actor Spoofing:** Blocked — RPCs ignore client-provided actorId

---

# D. CURRENT ROLE MODEL

## Role Types

```sql
CREATE TYPE user_role AS ENUM ('admin', 'co_admin', 'employee');
```

## Current Capability Matrix

| Capability | Owner/Admin | Co-Admin | Employee |
|------------|-------------|----------|----------|
| **View** |
| View Customers | ✅ | ✅ | ✅ |
| View Products | ✅ | ✅ | ✅ |
| View Sales | ✅ | ✅ | ✅ |
| View Purchases | ✅ | ✅ | ✅ |
| View Reports | ✅ | ✅ | ✅ |
| View Inventory | ✅ | ✅ | ✅ |
| View Payments | ✅ | ✅ | ✅ |
| View Employees | ✅ | ✅ | ❌ |
| **Create** |
| Create Sale | ✅ | ✅ | ✅ |
| Create Customer | ✅ | ✅ | ✅ |
| Record Customer Payment | ✅ | ✅ | ✅ |
| Create Purchase | ✅ | ✅ | ❌ |
| Record Supplier Payment | ✅ | ✅ | ❌ |
| Create Product | ✅ | ❌ | ❌ |
| **Edit** |
| Edit Customer | ✅ | ✅ | ❌ |
| Edit Product | ✅ | ❌ | ❌ |
| Edit Employee | ✅ | ❌ | ❌ |
| **Delete/Archive** |
| Archive Customer | ✅ | ✅ | ❌ |
| Delete Product | ✅ | ❌ | ❌ |
| **Admin** |
| Adjust Stock | ✅ | ❌ | ❌ |
| Void Sale | ✅ | ❌ | ❌ |
| Process Return | ✅ | ✅ | ✅ |
| Manage Employees | ✅ | ❌ | ❌ |
| Configure Settings | ✅ | ❌ | ❌ |
| Configure Reminders | ✅ | ✅ | ❌ |

## How Access is Determined

### Frontend (UI Layer)

```tsx
// ProtectedRoute.tsx
if (allowedRoles && !allowedRoles.includes(user.role)) {
  const home = user.role === "employee" ? "/employee/dashboard" : "/admin/dashboard";
  return <Navigate to={home} replace />;
}
```

**Two layouts:**
- `/admin/*` → AdminLayout (requires `admin` or `co_admin`)
- `/employee/*` → EmployeeLayout (any authenticated user)

### Backend (RPC Layer)

```sql
-- Example: void_sale checks role
SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
  RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can void sales';
END IF;
```

---

# E. CURRENT EMPLOYEE LIFECYCLE

## Today's Flow

```
Admin → Add Employee (Name + Phone + Role) → User Record Created → Employee Logs In → Access Granted
```

### Detailed Steps:

1. **Admin creates employee:**
   - Goes to More → Employees → Add Employee
   - Enters: Name, Phone, Role (co_admin or employee), Job Title
   - `employeesStore.createEmployee()` inserts directly into `users` table

2. **No invitation state:**
   - Employee is immediately active (`is_active = true`)
   - No pending/approval state exists

3. **Employee logs in:**
   - Phone + OTP → User found → Login succeeds
   - No approval check

4. **Deactivation:**
   - Admin can deactivate employee
   - Sets `is_active = false`, `deactivated_at`, `deactivated_by`
   - Employee sees "Access revoked" on next login

---

# F. FUTURE TARGET MODEL

## Target Architecture

```
User (Identity)
    ↓
Membership (Business Relationship)
    ↓
Business/Tenant
    ↓
Role
    ↓
Permissions
    ↓
Scope (Branch/Location)
```

## Target States

```text
INVITED → PENDING_APPROVAL → ACTIVE → SUSPENDED → DEACTIVATED
                                      ↓
                                  REJECTED
```

## Target Permission Model

```
Role (e.g., "Cashier")
    ↓
Permission Set (create_sale, view_customers, record_payment)
    ↓
Enforcement (RPC checks, RLS policies)
```

---

# G. GAP ANALYSIS

## What Exists Today vs What's Required

| Requirement | Current State | Gap | Priority |
|-------------|---------------|-----|----------|
| **User Identity** | ✅ `users` table with phone, role | None | — |
| **Business/Tenant** | ✅ `shops` table, `shop_id` everywhere | None | — |
| **Membership Model** | ❌ User = Membership combined | Need separate `memberships` table | HIGH |
| **Invitation State** | ❌ No pending state | Need `invited_at`, `invited_by`, `approval_status` | HIGH |
| **Approval Workflow** | ❌ No approval | Need admin approval flow | HIGH |
| **Role-Permission Mapping** | ❌ Hardcoded role checks | Need `roles`, `permissions`, `role_permissions` tables | MEDIUM |
| **Granular Permissions** | ❌ Binary (admin/employee) | Need fine-grained permission system | MEDIUM |
| **Branch/Scope** | ❌ Single shop today | Need `branch_id` support | LOW |
| **Multi-Business User** | ❌ One user = one shop | Need user can belong to multiple shops | LOW |
| **Invitation UI** | ❌ No invitation flow | Need admin invitation screen | HIGH |
| **Approval UI** | ❌ No approval screen | Need pending requests view | HIGH |
| **Employee Status States** | ⚠️ Only `is_active` boolean | Need full state machine | MEDIUM |

---

# H. CHANGES REQUIRED LATER

## Database Changes

### New Tables (Future)

```sql
-- Membership table (separates user from business relationship)
CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  shop_id UUID NOT NULL REFERENCES shops(id),
  role TEXT NOT NULL,  -- will reference roles table
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, active, suspended, deactivated
  invited_by UUID REFERENCES users(id),
  invited_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, shop_id)  -- one membership per user per shop
);

-- Roles table (configurable roles)
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,  -- e.g., 'cashier', 'manager'
  description TEXT,
  is_system BOOLEAN DEFAULT false,  -- system roles can't be deleted
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Permissions table
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,  -- e.g., 'create_sale', 'void_sale'
  description TEXT,
  category TEXT  -- e.g., 'sales', 'inventory', 'employees'
);

-- Role-Permission mapping
CREATE TABLE role_permissions (
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
```

### Columns to Add (Future)

```sql
-- users table
ALTER TABLE users ADD COLUMN supabase_auth_id UUID;  -- link to Supabase Auth

-- invitations table (optional, for explicit invitation tracking)
CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id),
  phone TEXT NOT NULL,
  role TEXT NOT NULL,
  invited_by UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Backend/Auth Changes

| Change | Impact | Risk |
|--------|--------|------|
| Update RPCs to check `membership.status = 'active'` | Medium | Low — add check after role check |
| Add permission-based checks instead of role-based | High | Medium — requires migration |
| Update `get_authenticated_user_id()` to return membership context | Medium | Low |
| Add `current_membership_id()` helper | Low | Low |

## Frontend Changes

| Change | Impact | Risk |
|--------|--------|------|
| Employee invitation UI | Medium | Low |
| Approval queue UI | Medium | Low |
| Role/Permission management UI | High | Medium |
| Status indicators (pending, active, etc.) | Low | Low |
| Notification for invitations/approvals | Medium | Low |

---

# I. MIGRATION STRATEGY

## Safe Migration Path for Existing Users

```text
Current Employee (users table)
       ↓
Existing User Record (unchanged)
       ↓
New Membership Record (created for existing active users)
       ↓
Mapped Role (admin → 'admin', employee → 'employee')
       ↓
Permission Set (inherited from role)
```

### Migration Steps:

1. Create `memberships` table
2. For each active user, create a membership record:
   - `user_id` = existing user id
   - `shop_id` = existing user's shop_id
   - `role` = existing user's role
   - `status` = 'active' (if is_active = true)
3. Create default roles (admin, co_admin, employee)
4. Create permission set for each role
5. Update RPCs to check membership instead of direct user role
6. Keep backward compatibility during transition

---

# J. DEPENDENCY MAP

## Features Dependent on Current Role Logic

| Feature | Location | Role Check | Future Impact |
|---------|----------|------------|---------------|
| Admin Layout | `AdminLayout.tsx` | `allowedRoles: ['admin', 'co_admin']` | Need membership check |
| Employee Layout | `EmployeeLayout.tsx` | Any authenticated | Need membership check |
| ProtectedRoute | `ProtectedRoute.tsx` | `user.role` check | Need membership status check |
| void_sale RPC | `0037_permission_model_hardening.sql` | `auth.uid() → role` | Need membership role check |
| adjust_stock RPC | `0037_permission_model_hardening.sql` | `auth.uid() → role` | Need membership role check |
| record_supplier_payment RPC | `0037_permission_model_hardening.sql` | `auth.uid() → role` | Need membership role check |
| create_product RPC | `0037_permission_model_hardening.sql` | `auth.uid() → role` | Need membership role check |
| update_product RPC | `0037_permission_model_hardening.sql` | `auth.uid() → role` | Need membership role check |
| delete_product RPC | `0037_permission_model_hardening.sql` | `auth.uid() → role` | Need membership role check |
| employeesStore | `employeesStore.ts` | Direct users table access | Need memberships join |
| More Menu | `MoreMenuPage.tsx` | Hidden for employees | Need permission check |

---

# K. SECURITY RISKS

## Current Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| User table serves dual purpose (auth + profile) | LOW | Separate concerns later |
| No invitation/approval state | MEDIUM | Add membership states |
| Role checks are hardcoded in RPCs | MEDIUM | Move to permission-based |
| No branch/scope isolation | LOW | Add branch_id later |
| Single shop assumption in many places | LOW | Already has shop_id, just needs enforcement |

## Future Risks to Avoid

| Risk | Mitigation |
|------|------------|
| Trusting client-provided membership/role | Keep using `auth.uid()` → server lookup |
| Allowing role escalation via direct update | Keep `prevent_role_escalation()` trigger |
| Skipping approval for new employees | Enforce `status = 'active'` check in RPCs |

---

# L. IMPLEMENTATION ORDER

## Dependency-Safe Sequence

### Phase 1: Identity Foundation (1-2 days)
- Create `memberships` table
- Migrate existing users to memberships
- Update `get_authenticated_user_id()` to return membership context

### Phase 2: Membership Model (1-2 days)
- Add membership states (pending, active, suspended, deactivated)
- Update login flow to check membership status
- Add `current_membership_id()` helper

### Phase 3: Roles & Permissions (2-3 days)
- Create `roles`, `permissions`, `role_permissions` tables
- Seed default roles and permissions
- Update RPCs to check permissions instead of hardcoded roles

### Phase 4: Invitations (1-2 days)
- Create invitation UI for admin
- Add invitation record tracking
- Send notification (optional)

### Phase 5: Approval Workflow (1-2 days)
- Create approval queue UI
- Add approval/rejection actions
- Update employee status on approval

### Phase 6: Access Enforcement (1-2 days)
- Update all RPCs to check membership status
- Update RLS policies if needed
- Test all role transitions

### Phase 7: Employee UI Updates (1-2 days)
- Update employee list to show status
- Add invitation/approval screens
- Update settings/role management

### Phase 8: Notifications (1 day)
- Invitation notifications
- Approval notifications
- Status change notifications

### Phase 9: Migration & Testing (2-3 days)
- Data migration for existing users
- E2E testing for all workflows
- Security testing

---

# M. EFFORT ESTIMATE

## Best Case: 10-12 days

## Realistic: 14-18 days

## Worst Case: 20-25 days

## Breakdown by Area

| Area | Days | Risk |
|------|------|------|
| Database schema + migrations | 2-3 | Low |
| Auth/session updates | 1-2 | Medium |
| Backend RPC updates | 2-3 | Medium |
| Authorization enforcement | 2-3 | Medium |
| Employee invitation UI | 1-2 | Low |
| Approval workflow UI | 1-2 | Low |
| Notifications | 1 | Low |
| Data migration | 1-2 | Medium |
| Testing | 2-3 | Medium |

## Biggest Technical Risks

1. **Migration of existing users to memberships** — Must be atomic and reversible
2. **Updating RPCs to check permissions** — Many RPCs to update, must not break existing flows
3. **Backward compatibility** — Old clients must still work during transition

---

# N. FUTURE TEST PLAN

## E2E Use Cases to Test

### 1. Owner Invites Employee
```
Owner → Add Employee → Enter Phone + Role → Send Invitation
→ Employee receives notification
→ Employee logs in → Sees "Pending Approval"
→ Owner approves → Employee becomes Active → Access granted
```

### 2. Employee Access Before Approval
```
Employee logs in → Phone + OTP verified
→ Membership status = 'pending'
→ Show "Waiting for approval" screen
→ Cannot access any business features
```

### 3. Employee Tries Admin Operation
```
Employee (role: cashier) → Tries to void sale
→ RPC checks permission: 'void_sale' NOT in cashier role
→ Returns NOT_AUTHORIZED
→ UI shows "You don't have permission"
```

### 4. Employee Deactivation
```
Owner → Deactivates employee
→ Membership status = 'suspended' or 'deactivated'
→ Employee's next login → "Access revoked" message
→ All API calls fail with NOT_AUTHORIZED
```

### 5. Same User, Multiple Businesses
```
User A belongs to Shop 1 (role: admin) and Shop 2 (role: employee)
→ User logs in → Selects shop
→ Membership for selected shop determines access
→ Switching shops changes available permissions
```

### 6. Role Change
```
Owner → Changes employee role from 'cashier' to 'manager'
→ Permission set updates immediately
→ Employee's next action uses new permissions
→ Audit log records the change
```

---

# O. CONCLUSION

## Summary

The current Agri Shop system has a **solid foundation** for employee onboarding:

✅ **Already exists:**
- User identity (phone + OTP auth)
- Business/tenant isolation (shop_id everywhere)
- Basic role model (admin, co_admin, employee)
- Actor attribution in all RPCs
- RLS hardening (Phase 4)
- Trusted identity via JWT

❌ **Needs to be built:**
- Membership model (separate user from business relationship)
- Invitation workflow
- Approval workflow
- Permission-based access control
- Status state machine (pending, active, suspended, etc.)
- Employee management UI updates

## Recommendation

The system is **NOT READY** for production employee onboarding today, but the architecture is sound. The existing `shop_id` multi-tenancy and role-based RPCs provide a strong foundation.

**Estimated effort:** 14-18 days for a complete, production-ready employee onboarding system.

**Priority:** Build membership model first, then layer permissions on top.

---

*This is a discovery document only. No code changes were made.*
