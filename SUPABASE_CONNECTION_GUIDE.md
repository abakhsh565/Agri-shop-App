# Supabase Connection Guide — End to End

## What You Need to Do (Manual Steps)

### Step 1: Go to Supabase Dashboard
1. Open https://supabase.com/dashboard
2. Sign in with your account
3. Select your project: **cmubdztiiqnxpwbvpzke**

### Step 2: Open SQL Editor
1. Click **SQL Editor** in the left sidebar
2. Click **New Query**

### Step 3: Run the Base Schema (If Not Already Created)
The Figma Make scaffold may have already created the base tables. If not, you need the original Figma Make migration first. Check if these tables exist:
- `shops`
- `users`
- `products`
- `product_variants`
- `customers`
- `sales`
- `sale_items`
- `customer_payments`
- `purchases`
- `purchase_items`
- `supplier_payments`
- `stock_adjustments`
- `returns`
- `return_items`
- `notifications`

**If they exist:** Skip to Step 4.
**If they don't:** Run the Figma Make migration first, then proceed.

### Step 4: Run Migration 0009 (Schema Upgrade)
Copy the entire content of `supabase/migrations/0009_complete_schema.sql` and paste it into the SQL Editor. Click **Run**.

### Step 5: Run Migration 0010 (RLS Policies)
Copy `supabase/migrations/0010_comprehensive_rls.sql` → Paste → Run.

### Step 6: Run Migration 0011 (New RPCs)
Copy `supabase/migrations/0011_new_rpc_functions.sql` → Paste → Run.

### Step 7: Run Migration 0012 (Updated RPCs)
Copy `supabase/migrations/0012_update_existing_rpcs.sql` → Paste → Run.

### Step 8: Run Migration 0013 (Storage)
Copy `supabase/migrations/0013_storage_buckets.sql` → Paste → Run.

### Step 9: Run Migration 0014 (Barcode)
Copy `supabase/migrations/0014_add_barcode.sql` → Paste → Run.

### Step 10: Run Migration 0015 (Flexible Units)
Copy `supabase/migrations/0015_flexible_units.sql` → Paste → Run.

### Step 11: Run Migration 0016 (Customer Archive)
Copy `supabase/migrations/0016_customer_archive_sales_snapshot.sql` → Paste → Run.

### Step 12: Run Migration 0017 (Phone Uniqueness)
Copy `supabase/migrations/0017_phone_uniqueness.sql` → Paste → Run.

### Step 13: Create .env.local File
Create a file called `.env.local` in the project root with:

```
VITE_SUPABASE_URL=https://cmubdztiiqnxpwbvpzke.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtdWJkenRpaXFueHB3YnZwemtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNzY3MDUsImV4cCI6MjEwMjY1MjcwNX0.EqfIDitXNkg6tr4R87K7FZndfudtMM0_odLEOh6EQZQ
VITE_SUPABASE_PROJECT_ID=cmubdztiiqnxpwbvpzke
```

### Step 14: Restart Dev Server
```bash
cd "C:\Users\mg\Downloads\Agrishop Inventory management system - New"
npm run dev
```

---

## What I (AI) Need to Connect via MCP

To let me make changes directly to your Supabase database, you need to provide me with these keys:

### Required Keys

| Key | Name | Where to Find It |
|-----|------|------------------|
| **1. Service Role Key** | `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API → `service_role` key (the one with the eye icon, NOT the anon key) |
| **2. Project URL** | `SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL: `https://cmubdztiiqnxpwbvpzke.supabase.co` |
| **3. Database Connection String** | `DATABASE_URL` | Supabase Dashboard → Settings → Database → Connection string → URI (the one under "Connection pooling") |
| **4. Anon Key** | `SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API → `anon` key (you already have this) |

### Where to Find Each Key

**Service Role Key:**
1. Go to https://supabase.com/dashboard
2. Select project → **Settings** (gear icon, bottom left)
3. Click **API** in the left sidebar
4. Under **Project API keys**, find `service_role`
5. Click the eye icon to reveal → Copy

**Database Connection String:**
1. Go to **Settings** → **Database**
2. Under **Connection string**, click **URI**
3. Copy the full connection string
4. It looks like: `postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`

### How to Give Me Access

**Option A: Environment Variables (Recommended)**
Set these as environment variables and I can read them:
```bash
export SUPABASE_SERVICE_ROLE_KEY="your-key-here"
export DATABASE_URL="your-connection-string"
```

**Option B: Direct Values**
Just paste the values in chat and I'll use them.

**Option C: .env.local**
Add them to `.env.local`:
```
SUPABASE_SERVICE_ROLE_KEY=your-key-here
DATABASE_URL=your-connection-string
```

---

## What I CAN Do With These Keys

| Task | How |
|------|-----|
| Run SQL migrations | Direct database access via connection string |
| Create/modify tables | Direct DDL |
| Create/modify RPC functions | Direct PL/pgSQL |
| Create/modify RLS policies | Direct SQL |
| Create storage buckets | Supabase Management API |
| Test queries | Direct database queries |
| Debug issues | Direct database inspection |
| Seed test data | Direct inserts |
| Verify data integrity | Direct queries |

## What I CANNOT Do (Requires Your Manual Action)

| Task | Why |
|------|-----|
| Enable Supabase Auth (OTP provider) | Dashboard → Authentication → Providers → enable Phone |
| Set up Twilio/SMS provider | Dashboard → Authentication → Providers → Twilio settings |
| Configure project settings | Dashboard → Settings |
| Deploy Edge Functions | Dashboard → Edge Functions |
| Set up custom domain | Dashboard → Settings → General |

---

## Quick Verification After Connection

Once connected, run this in SQL Editor to verify:
```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Check RPC functions exist
SELECT routine_name FROM information_schema.routines 
WHERE routine_schema = 'public' 
ORDER BY routine_name;

-- Check RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;
```

Expected: ~20+ tables, ~15+ functions, all with `rowsecurity = true`.
