# Run Instructions

## How to reproduce the dev server

1. `cd` to the project root
2. `npm install` (dependencies already installed in `node_modules/`)
3. The Supabase config lives in `utils/supabase/info.tsx` — it defaults to the Figma Make scaffold project. Override via env vars:
   - `VITE_SUPABASE_URL` — full Supabase URL
   - `VITE_SUPABASE_ANON_KEY` — public anon key
   - `VITE_SUPABASE_PROJECT_ID` — project ID (used to construct URL if VITE_SUPABASE_URL not set)

## How to run the server

```bash
PORT=5173 npx vite --host 0.0.0.0 --port 5173
```

On Windows PowerShell:
```powershell
$env:PORT='5173'; npx vite --host 0.0.0.0 --port 5173
```

Default port from `vite.config.ts` is 8443 with `strictPort: true`. Using `--port 5173` overrides that.

For background (detached) mode on Windows:
```powershell
Start-Process -FilePath 'npx' -ArgumentList 'vite','--host','0.0.0.0','--port','5173' -WorkingDirectory '<project-root>' -WindowStyle Hidden
```

## Reproduce artifacts

- Copy `.env.local` from main checkout if present (procedure only — never copy secrets)
- Run `npm install` to populate `node_modules/`

## SQL Migrations (for Supabase SQL Editor)

Run in order:
1. `supabase/migrations/0009_complete_schema.sql` — Multi-tenancy, missing tables/columns, indexes
2. `supabase/migrations/0010_comprehensive_rls.sql` — RLS policies for all tables
3. `supabase/migrations/0011_new_rpc_functions.sql` — void_sale, cash_reconciliation, deactivate_employee, update_product, delete_product
4. `supabase/migrations/0012_update_existing_rpcs.sql` — Fixed create_sale + create_purchase with shop_id + FIFO COGS + inventory movements
5. `supabase/migrations/0013_storage_buckets.sql` — Storage buckets for image uploads (product-images, employee-photos, company-logos, customer-images)

## Known Issues (resolved after running migrations)

- Delete product shows 404 → `delete_product` RPC doesn't exist yet (migration 0011)
- Image uploads fail → storage buckets don't exist yet (migration 0013)
- Products query 400 → `is_active` filter removed temporarily; re-add after migration 0007 is applied

## Existing migrations (from Figma Make scaffold)

The `dev-guide-extracted/supabase/migrations/` folder contains migrations 0001-0008 which were applied to the live Supabase project. Migrations 0009-0013 are the new additions.
