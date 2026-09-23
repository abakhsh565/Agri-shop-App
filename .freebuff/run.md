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
PORT=5173 npx vite --mode qa --host 0.0.0.0 --port 5173
```

On Windows PowerShell:
```powershell
$env:PORT='5173'; npx vite --mode qa --host 0.0.0.0 --port 5173
```

**Do NOT use `npm run dev` for the preview.** The `dev` script is `vite --host 0.0.0.0` —
it omits `--mode qa` (confirmed from package.json), so it starts without `.env.qa` and is
not the server the E2E suite reuses. Always pass `--mode qa` explicitly, as above.

`--mode qa` is required, not optional. It is what makes Vite load `.env.qa` and
therefore the QA Supabase project (`bpybjrjenwccowvtrevu`). Without it the server falls
back to `.env.local` or the scaffold default in `utils/supabase/info.tsx`, which is how a
test can silently end up reading production data. `src/lib/envGuard.ts` hard-fails a dev
server that points at production, and `assertQaEnvironment()` asserts QA server-side; the
Playwright config reuses an already-running server on 5173, so a server on the wrong mode
would be reused silently. Playwright's own `webServer` command already passes `--mode qa`.

Default port from `vite.config.ts` is 8443 with `strictPort: true`. Using `--port 5173` overrides that.

For background (detached) mode on Windows, the reliable form uses `node.exe` directly (not `npm.cmd`):
```powershell
$log = '<log>'
$logErr = "$log.err"
$p = (Start-Process -FilePath 'node.exe' -ArgumentList 'node_modules\vite\bin\vite.js','--mode','qa','--host','0.0.0.0','--port','<port>' -WorkingDirectory '<project-root>' -RedirectStandardOutput $log -RedirectStandardError $logErr -WindowStyle Hidden -PassThru).Id
# NOTE: do NOT name this variable $pid — $pid is a read-only PowerShell automatic
# variable and the assignment fails. Use $p (or any other name).
Write-Output "PID=$p"
```

`Start-Process` returns immediately, but redirecting output keeps the parent shell attached until
it exits — run this from a shell with a generous timeout, or poll `netstat` for the port instead
of waiting on the command. `--host 0.0.0.0` is fine; the app is reachable at `http://127.0.0.1:<port>/`.

Pick a free port. 5173/5174/5175 may already be in use — check with
`netstat -ano | grep ":5173"` before starting (5173 is the port this run doc assumes for
the preview). Do not kill a running server with a process filter matching `vite` from
the same shell — the filter also matches the shell running the command and kills it (and
the `Start-Process` in the same command line) before it starts. Match the pid instead.

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
