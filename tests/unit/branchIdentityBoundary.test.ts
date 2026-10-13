import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { splitStatementsWithOffsets, splitStatements } from '../../scripts/lib/sql-statements.mjs';
import { isDataStatement, phaseReader, EXPECTED_PHASE } from '../../scripts/lib/baseline.mjs';

// No remote service, no real personal data: load only schema from the recorded
// QA snapshot. This is SQL behavior evidence, not a substitute for live API/UI.
const baseline = JSON.parse(fs.readFileSync('supabase/baseline/staging-baseline.json', 'utf8'));

/**
 * The snapshot this suite executes SQL against is a logical dump of a real environment, so it lives
 * in gitignored `backups/` and is deliberately not in the repository. Where it is absent — CI must
 * not carry one — the suite reports itself as SKIPPED with the reason instead of dying on an ENOENT
 * that says nothing about the branch rules it is there to prove. `schemaBaseline.test.ts` holds its
 * artifact-dependent assertions to the same rule, and the owner-side replay
 * (`npm run verify:baseline -- --baseline staging --since <version>`) is where those files are run:
 * a check that did not run is reported as skipped, never as passed.
 */
const baselineArtifactPath = path.resolve(baseline.artifact);
const haveBaselineArtifact = fs.existsSync(baselineArtifactPath);
if (!haveBaselineArtifact) {
  console.warn(
    `[branchIdentityBoundary] SKIPPED: ${baseline.artifact} is not present (it is a gitignored ` +
      'environment snapshot). Run `npm run verify:baseline` where the artifact exists.',
  );
}
const suite = haveBaselineArtifact ? describe : describe.skip;
const db = new PGlite();
const tenant = 'e1880000-0000-0000-0000-000000000001';
const otherTenant = 'e1880000-0000-0000-0000-000000000002';
const main = 'e1880000-0000-0000-0000-000000000011';
const warehouse = 'e1880000-0000-0000-0000-000000000012';
const foreign = 'e1880000-0000-0000-0000-000000000013';
const owner = 'e1880000-0000-0000-0000-000000000021';
const mainUser = 'e1880000-0000-0000-0000-000000000022';
const warehouseUser = 'e1880000-0000-0000-0000-000000000023';
const multiUser = 'e1880000-0000-0000-0000-000000000024';
const missingUser = 'e1880000-0000-0000-0000-000000000025';
const saleMain = 'e1880000-0000-0000-0000-000000000031';
const saleWarehouse = 'e1880000-0000-0000-0000-000000000032';
const saleRole = 'e1880000-0000-0000-0000-000000000041';

async function asUser<T>(id: string, run: () => Promise<T>): Promise<T> {
  await db.exec('BEGIN');
  try {
    await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: 'authenticated' })]);
    await db.exec('SET LOCAL ROLE authenticated');
    const result = await run();
    await db.exec('RESET ROLE; COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
async function branches(id: string) {
  return asUser(id, async () => (await db.query('SELECT * FROM public.get_my_branches()')).rows as Array<Record<string, any>>);
}
async function visibleSales(id: string) {
  return asUser(id, async () => (await db.query('SELECT id, branch_id FROM public.sales ORDER BY id')).rows);
}

beforeAll(async () => {
  // This hook is at module scope, so it runs even when the suite below is skipped: without this
  // guard it would still try to read the artifact and fail the file.
  if (!haveBaselineArtifact) return;
  await db.exec(`
    CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA storage; CREATE SCHEMA cron;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
    CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean);
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(), bucket_id text, name text,
      owner uuid, path_tokens text[], metadata jsonb);
    CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
    CREATE FUNCTION cron.schedule(schedule text, command text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
    CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE PUBLICATION supabase_realtime;
  `);
  const source = fs.readFileSync(baseline.artifact, 'utf8');
  const phase = phaseReader(source);
  for (const entry of splitStatementsWithOffsets(source)) {
    if (isDataStatement(entry.text)) continue;
    try { await db.exec(entry.text); }
    catch (error) {
      if (phase(entry.offset) !== EXPECTED_PHASE) throw error;
    }
  }
  const directory = 'supabase/migrations';
  // 0188, not 0178. The recorded baseline states its own position — `ledgerOnServer.latest` is
  // 0187 — so the snapshot ALREADY contains 0178-0187. Replaying them applied 0181's
  // `create policy audit_events_no_client_writes` on top of a snapshot that already had that
  // policy, and the whole suite died at setup on `already exists` before one assertion ran.
  // The forward check is the files the baseline does not have; that boundary is the baseline's
  // own recorded truth, not a guess.
  for (const file of fs.readdirSync(directory).filter(f => f.endsWith('.sql') && f.slice(0, 4) >= '0188' && f.slice(0, 4) <= '0196').sort()) {
    for (const sql of splitStatements(fs.readFileSync(path.join(directory, file), 'utf8'))) await db.exec(sql);
  }
  // The captured logical dump omits Supabase's platform default grants, and
  // permission reference rows were intentionally skipped with all real data.
  // State the real client privileges and the fixture's permission codes here.
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT SELECT ON public.sales TO authenticated;
    CREATE FUNCTION public.fixture_insert_sale(p_actor uuid,p_tenant uuid,p_branch uuid,p_number text)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
      INSERT INTO public.sales(sale_number,employee_id,total_amount,amount_paid,amount_due,shop_id,branch_id)
      VALUES(p_number,p_actor,1,1,0,p_tenant,p_branch); END $$;
    GRANT EXECUTE ON FUNCTION public.fixture_insert_sale(uuid,uuid,uuid,text) TO authenticated;
    GRANT SELECT ON public.audit_events, public.users TO authenticated;
    INSERT INTO permissions(code,module,action,label_en,label_ur) VALUES
      ('sales.view','sales','view','View sales','فروخت دیکھیں'),
      ('sales.create','sales','create','Create sales','فروخت کریں'),
      ('employees.manage','employees','manage','Manage employees','عملہ سنبھالیں'),
      ('activity.view','activity','view','View activity','سرگرمی دیکھیں'),
      ('settings.edit','settings','edit','Edit settings','ترتیبات بدلیں'),
      ('sales.void','sales','void','Cancel sales','فروخت منسوخ کریں'),
      ('returns.create','returns','create','Process returns','واپسی کریں'),
      ('purchases.create','purchases','create','Record purchases','خریداری درج کریں'),
      ('customers.payments','customers','payments','Record payments','ادائیگی درج کریں'),
      ('payments.supplier','payments','supplier','Pay suppliers','سپلائر کو ادائیگی کریں'),
      ('inventory.adjust','inventory','adjust','Adjust stock','اسٹاک بدلیں');
    INSERT INTO shops(id,name) VALUES ('${tenant}','Branch identity fixture'), ('${otherTenant}','Foreign fixture');
    INSERT INTO branches(id,tenant_id,name,is_default,is_active) VALUES
      ('${main}','${tenant}','Main',true,true), ('${warehouse}','${tenant}','Warehouse',false,true),
      ('${foreign}','${otherTenant}','Foreign',true,true);
    INSERT INTO users(id,name,phone,role,is_original_owner,is_active,shop_id) VALUES
      ('${owner}','Fixture Owner','923018800001','admin',true,true,'${tenant}'),
      ('${mainUser}','Fixture Main','923018800002','employee',false,true,'${tenant}'),
      ('${warehouseUser}','Fixture Warehouse','923018800003','employee',false,true,'${tenant}'),
      ('${multiUser}','Fixture Multiple','923018800004','employee',false,true,'${tenant}'),
      ('${missingUser}','Fixture Missing','923018800005','employee',false,true,'${tenant}');
    INSERT INTO roles(id,tenant_id,name) VALUES ('${saleRole}','${tenant}','Sales fixture');
    INSERT INTO role_permissions(role_id,permission_id)
      SELECT '${saleRole}',id FROM permissions WHERE code IN ('sales.view','sales.create');
    UPDATE memberships SET branch_scope=ARRAY['${main}']::uuid[],role_id='${saleRole}' WHERE user_id='${mainUser}';
    UPDATE memberships SET branch_scope=ARRAY['${warehouse}']::uuid[],role_id='${saleRole}' WHERE user_id='${warehouseUser}';
    UPDATE memberships SET branch_scope=ARRAY['${main}','${warehouse}']::uuid[],role_id='${saleRole}' WHERE user_id='${multiUser}';
    UPDATE memberships SET role_id='${saleRole}' WHERE user_id='${missingUser}';
    INSERT INTO sales(id,sale_number,employee_id,total_amount,amount_paid,amount_due,shop_id,branch_id) VALUES
      ('${saleMain}','BRANCH-MAIN','${owner}',100,100,0,'${tenant}','${main}'),
      ('${saleWarehouse}','BRANCH-WAREHOUSE','${owner}',5000,5000,0,'${tenant}','${warehouse}');
  `);
}, 60000);
afterAll(async () => { await db.close(); });

suite('real branch identity and fail-closed scope — executed SQL', () => {
  it('owner receives actual Main and Warehouse records, never the tenant as the branch id', async () => {
    const rows = await branches(owner);
    expect(rows.map(r => r.branch_id)).toEqual([main, warehouse]);
    expect(rows.every(r => r.tenant_id === tenant)).toBe(true);
    expect(rows.every(r => r.branch_id !== r.tenant_id)).toBe(true);
    expect(rows.map(r => Number(r.sales_total))).toEqual([100, 5000]);
    expect(rows.every(r => r.product_count === null && r.customer_count === null)).toBe(true);
  });
  it('reproduces the 5000 Warehouse leak fixture and excludes it from Main RPC totals', async () => {
    const rows = await branches(mainUser);
    expect(rows.map(r => r.branch_id)).toEqual([main]);
    expect(Number(rows[0].sales_total)).toBe(100);
    expect(Number(rows[0].sales_count)).toBe(1);
    expect(await visibleSales(mainUser)).toEqual([{ id: saleMain, branch_id: main }]);
  });
  it('Warehouse employee sees only Warehouse through RLS and the definer RPC', async () => {
    const rows = await branches(warehouseUser);
    expect(rows.map(r => r.branch_id)).toEqual([warehouse]);
    expect(Number(rows[0].sales_total)).toBe(5000);
    expect(await visibleSales(warehouseUser)).toEqual([{ id: saleWarehouse, branch_id: warehouse }]);
  });
  it('missing employee scope gives no branches, no reads, no RPC authorization', async () => {
    expect(await branches(missingUser)).toEqual([]);
    expect(await visibleSales(missingUser)).toEqual([]);
    await expect(asUser(missingUser, () => db.query("SELECT authorize_business_action('sales.create')"))).rejects.toThrow('branch access denied');
    await expect(asUser(missingUser, () => db.query('SELECT set_active_branch($1)', [main]))).rejects.toThrow('branch access denied');
  });
  it('refuses direct writes into the wrong branch and cross-tenant branches', async () => {
    for (const [user, branch] of [[mainUser, warehouse], [warehouseUser, main], [owner, foreign]]) {
      await expect(asUser(user, () => db.query(
        "SELECT fixture_insert_sale($1,$2,$3,'FORBIDDEN')", [user, tenant, branch],
      ))).rejects.toThrow(/branch access denied/);
    }
    expect((await db.query("SELECT count(*)::int n FROM sales WHERE sale_number='FORBIDDEN'")).rows).toEqual([{ n: 0 }]);
  });
  it('a definer update cannot move an inaccessible Warehouse record into Main', async () => {
    // This executes with definer-like table privileges while retaining the
    // real actor claims: the trigger must guard OLD as well as NEW.
    await db.exec('BEGIN');
    try {
      await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: mainUser, role: 'authenticated' })]);
      await expect(db.query('UPDATE sales SET branch_id=$1 WHERE id=$2', [main, saleWarehouse])).rejects.toThrow('branch access denied');
    } finally { await db.exec('ROLLBACK'); }
    expect((await db.query('SELECT branch_id FROM sales WHERE id=$1', [saleWarehouse])).rows).toEqual([{ branch_id: warehouse }]);
  });
  it('missing scope cannot write even with an otherwise valid sales permission', async () => {
    await expect(asUser(missingUser, () => db.query(
      "SELECT fixture_insert_sale($1,$2,NULL,'MISSING-SCOPE')", [missingUser, tenant],
    ))).rejects.toThrow('branch access denied');
  });
  it('selected branch persists in existing server context and never changes the actor', async () => {
    await asUser(owner, () => db.query('SELECT set_active_branch($1)', [warehouse]));
    const context = await asUser(owner, () => db.query('SELECT current_shop_id() tenant, current_branch_id() branch, app_current_user_id() actor'));
    expect(context.rows).toEqual([{ tenant, branch: warehouse, actor: owner }]);
    expect(await visibleSales(owner)).toEqual([{ id: saleWarehouse, branch_id: warehouse }]);
    await asUser(owner, () => db.query('SELECT set_active_branch($1)', [main]));
    expect(await visibleSales(owner)).toEqual([{ id: saleMain, branch_id: main }]);
  });
  it('multi-branch member lists both authorized branches and works only in the selected branch', async () => {
    expect((await branches(multiUser)).map(r => r.branch_id)).toEqual([main, warehouse]);
    await asUser(multiUser, () => db.query('SELECT set_active_branch($1)', [warehouse]));
    expect(await visibleSales(multiUser)).toEqual([{ id: saleWarehouse, branch_id: warehouse }]);
    await expect(asUser(multiUser, () => db.query('SELECT set_active_branch($1)', [foreign]))).rejects.toThrow('branch access denied');
  });
  it('rejects new missing employee scope without guessing Main or widening access', async () => {
    await expect(db.query('UPDATE memberships SET branch_scope=NULL WHERE user_id=$1', [mainUser])).rejects.toThrow('explicit branches are required');
    expect((await branches(mainUser)).map(r => r.branch_id)).toEqual([main]);
  });
  it('Add preserves existing branch access, Move replaces it, and both are idempotent without moving history', async () => {
    await asUser(owner, () => db.query('SELECT set_active_branch($1)', [warehouse]));
    const history = (await db.query('SELECT id,branch_id,employee_id FROM sales ORDER BY id')).rows;
    const person = (await db.query('SELECT id,phone FROM users WHERE id=$1', [mainUser])).rows;
    const add = await asUser(owner, () => db.query('SELECT assign_employee_branch($1,$2,$3) result', [mainUser, warehouse, 'add']));
    expect((add.rows[0] as any).result.branchScope).toEqual([main, warehouse]);
    const repeatedAdd = await asUser(owner, () => db.query('SELECT assign_employee_branch($1,$2,$3) result', [mainUser, warehouse, 'add']));
    expect((repeatedAdd.rows[0] as any).result.idempotent).toBe(true);
    const move = await asUser(owner, () => db.query('SELECT assign_employee_branch($1,$2,$3) result', [mainUser, warehouse, 'move']));
    expect((move.rows[0] as any).result.branchScope).toEqual([warehouse]);
    const repeatedMove = await asUser(owner, () => db.query('SELECT assign_employee_branch($1,$2,$3) result', [mainUser, warehouse, 'move']));
    expect((repeatedMove.rows[0] as any).result.idempotent).toBe(true);
    expect((await db.query('SELECT id,branch_id,employee_id FROM sales ORDER BY id')).rows).toEqual(history);
    expect((await db.query('SELECT id,phone FROM users WHERE id=$1', [mainUser])).rows).toEqual(person);
    const audit = (await db.query("SELECT user_id,branch_id,actor_role,action FROM audit_events WHERE entity_id=$1 AND action IN ('employee_branch_add','employee_branch_move') ORDER BY created_at,id", [mainUser])).rows as any[];
    expect(audit).toHaveLength(2);
    expect(audit.every(r => r.user_id === owner && r.branch_id === warehouse && r.actor_role === 'owner')).toBe(true);
    await db.query('UPDATE memberships SET branch_scope=ARRAY[$1]::uuid[] WHERE user_id=$2', [main, mainUser]);
    await asUser(owner, () => db.query('SELECT set_active_branch($1)', [main]));
  });
  it('sale audit takes the real session actor and selected branch, never a supplied identity', async () => {
    await asUser(owner, () => db.query('SELECT set_active_branch($1)', [warehouse]));
    await asUser(owner, () => db.query("SELECT fixture_insert_sale($1,$2,NULL,'AUDITED')", [mainUser, tenant]));
    const audit = (await db.query("SELECT user_id,tenant_id,branch_id,actor_role,details FROM audit_events WHERE action='sale_created' AND details->'after'->>'saleNumber'='AUDITED'")).rows as any[];
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ user_id: owner, tenant_id: tenant, branch_id: warehouse, actor_role: 'owner' });
    expect(audit[0].details.result).toBe('succeeded');
    await asUser(owner, () => db.query('SELECT set_active_branch($1)', [main]));
  });
  it('normal invitation from Warehouse enrolls one account in Warehouse and onboarding preserves it', async () => {
    await asUser(owner, () => db.query('SELECT set_active_branch($1)', [warehouse]));
    const invitation = await asUser(owner, () => db.query('SELECT create_employee($1::jsonb) result', [
      JSON.stringify({ name: 'Invited Warehouse', phone: '923018800099', roleId: saleRole, branchScope: [warehouse] }),
    ]));
    const id = (invitation.rows[0] as any).result.id;
    expect(id).toBeTruthy();
    expect((await db.query('SELECT branch_scope,status::text FROM memberships WHERE user_id=$1', [id])).rows)
      .toEqual([{ branch_scope: [warehouse], status: 'pending' }]);
    await asUser(id, () => db.query('SELECT complete_member_onboarding()'));
    expect((await db.query('SELECT branch_scope,status::text FROM memberships WHERE user_id=$1', [id])).rows)
      .toEqual([{ branch_scope: [warehouse], status: 'active' }]);
    expect((await branches(id)).map(r => r.branch_id)).toEqual([warehouse]);
    expect((await db.query("SELECT count(*)::int n FROM users WHERE phone='923018800099'")).rows).toEqual([{ n: 1 }]);
    await expect(asUser(owner, () => db.query('SELECT create_employee($1::jsonb)', [
      JSON.stringify({ name: 'Invited Warehouse', phone: '923018800099', roleId: saleRole, branchScope: [warehouse] }),
    ]))).rejects.toThrow('DUPLICATE_PHONE');
    await asUser(owner, () => db.query('SELECT set_active_branch($1)', [main]));
  });
  it('activity.view produces a real branch-scoped read and role snapshots survive later role edits', async () => {
    const auditRole = 'e1880000-0000-0000-0000-000000000042';
    await db.query("INSERT INTO roles(id,tenant_id,name) VALUES($1,$2,'Activity fixture')", [auditRole, tenant]);
    await db.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code='activity.view'", [auditRole]);
    await db.query('UPDATE memberships SET role_id=$1 WHERE user_id=$2', [auditRole, warehouseUser]);
    const rows = await asUser(warehouseUser, () => db.query('SELECT branch_id,actor_role FROM audit_events'));
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows.every((r: any) => r.branch_id === warehouse)).toBe(true);
    const denied = await asUser(mainUser, () => db.query('SELECT id FROM audit_events'));
    expect(denied.rows).toEqual([]);
    // Trusted writer with employee JWT: the trigger derives the role-at-time
    // even when the INSERT tries to attribute the event to the owner.
    await db.exec('BEGIN');
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: warehouseUser, role: 'authenticated' })]);
    await db.query("INSERT INTO audit_events(user_id,action,entity_type,entity_id) VALUES($1,'role_snapshot_fixture','user',$1)", [owner]);
    await db.exec('COMMIT');
    const snapshot = (await db.query("SELECT actor_role,user_id FROM audit_events WHERE action='role_snapshot_fixture'")).rows;
    expect(snapshot).toEqual([{ actor_role: 'Activity fixture', user_id: warehouseUser }]);
    await db.query("UPDATE roles SET name='Renamed activity fixture' WHERE id=$1", [auditRole]);
    expect((await db.query("SELECT actor_role,user_id FROM audit_events WHERE action='role_snapshot_fixture'")).rows).toEqual(snapshot);
    await db.query('UPDATE memberships SET role_id=$1 WHERE user_id=$2', [saleRole, warehouseUser]);
    await asUser(owner, () => db.query('SELECT set_active_branch($1)', [main]));
  });
  it('an employee cannot Add/Move employees by calling the RPC directly', async () => {
    await expect(asUser(warehouseUser, () => db.query('SELECT assign_employee_branch($1,$2,$3)', [mainUser, warehouse, 'move']))).rejects.toThrow('missing permission employees.manage');
  });
  it('creates a real branch with name/location only, retrying the same identity without copying people or roles', async () => {
    const id = 'e1910000-0000-0000-0000-000000000001';
    const before = (await db.query('SELECT (SELECT count(*) FROM shops) shops,(SELECT count(*) FROM users) users,(SELECT count(*) FROM roles) roles')).rows;
    const args = [id, 'New operating branch', 31.52, 74.35, 'Lahore', 'Fixture location', 'openstreetmap'];
    const create = () => asUser(owner, () => db.query('SELECT create_operating_branch($1,$2,$3,$4,$5,$6,$7) result', args));
    expect((await create()).rows[0]).toMatchObject({ result: { success: true, tenant_id: tenant, branch_id: id } });
    expect((await create()).rows[0]).toMatchObject({ result: { idempotent: true } });
    expect((await db.query('SELECT (SELECT count(*) FROM shops) shops,(SELECT count(*) FROM users) users,(SELECT count(*) FROM roles) roles')).rows).toEqual(before);
    await expect(asUser(mainUser, () => db.query('SELECT create_operating_branch($1,$2,$3,$4)', ['e1910000-0000-0000-0000-000000000002', 'Denied', 31, 74]))).rejects.toThrow('only the business owner');
    await expect(asUser(owner, () => db.query('SELECT create_operating_branch($1,$2,$3,$4)', ['e1910000-0000-0000-0000-000000000002', 'New operating branch', 31, 74]))).rejects.toThrow('BRANCH_NAME_TAKEN');
    await expect(asUser(owner, () => db.query('SELECT create_operating_branch($1,$2,$3,$4)', ['e1910000-0000-0000-0000-000000000003', 'No location', null, null]))).rejects.toThrow('choose a branch location');
    await asUser(owner, () => db.query('SELECT archive_operating_branch($1,$2)', [id, 'Fixture complete']));
    const repeat = await asUser(owner, () => db.query('SELECT archive_operating_branch($1,$2) result', [id, 'Fixture complete']));
    expect(repeat.rows[0]).toMatchObject({ result: { idempotent: true } });
  });
  it('renames only the operating branch and refuses the legacy tenant-purge API', async () => {
    const shop = (await db.query('SELECT name FROM shops WHERE id=$1', [tenant])).rows;
    await asUser(owner, () => db.query('SELECT rename_branch($1,$2)', [warehouse, 'Warehouse renamed']));
    expect((await db.query('SELECT name FROM shops WHERE id=$1', [tenant])).rows).toEqual(shop);
    expect((await db.query('SELECT name FROM branches WHERE id=$1', [warehouse])).rows).toEqual([{ name: 'Warehouse renamed' }]);
    await expect(asUser(owner, () => db.query('SELECT rename_branch($1,$2)', [tenant, 'Business wrongly renamed']))).rejects.toThrow('BRANCH_NOT_FOUND');
    await expect(asUser(owner, () => db.query('SELECT delete_branch($1)', [tenant]))).rejects.toThrow('permission denied');
    await asUser(owner, () => db.query('SELECT rename_branch($1,$2)', [warehouse, 'Warehouse']));
  });
  it('archives preserve records and refuse Main, foreign branches and unresolved employee access', async () => {
    const history = (await db.query('SELECT id,branch_id,employee_id FROM sales ORDER BY id')).rows;
    await expect(asUser(owner, () => db.query('SELECT archive_operating_branch($1,$2)', [main, 'No']))).rejects.toThrow('MAIN_BRANCH');
    await expect(asUser(owner, () => db.query('SELECT archive_operating_branch($1,$2)', [foreign, 'No']))).rejects.toThrow('BRANCH_NOT_FOUND');
    await expect(asUser(owner, () => db.query('SELECT archive_operating_branch($1,$2)', [warehouse, 'No']))).rejects.toThrow('BRANCH_HAS_STAFF');
    expect((await db.query('SELECT id,branch_id,employee_id FROM sales ORDER BY id')).rows).toEqual(history);
    expect((await db.query('SELECT is_active FROM branches WHERE id=$1', [warehouse])).rows).toEqual([{ is_active: true }]);
  });
  it('location writes check the actual branch/tenant, not merely membership in some business', async () => {
    await expect(asUser(owner, () => db.query("SELECT set_place('branches',$1,31,74)", [foreign]))).rejects.toThrow('tenant access denied');
    await asUser(owner, () => db.query("SELECT set_place('branches',$1,31.5,74.3,'Fixture','Fixture address','openstreetmap')", [warehouse]));
    expect((await db.query('SELECT latitude,longitude FROM branches WHERE id=$1', [warehouse])).rows).toEqual([{ latitude: 31.5, longitude: 74.3 }]);
  });
  it('refuses wrong-branch void/return before any side effect and blocks a sale retry leaking another branch', async () => {
    await asUser(owner, () => db.query('SELECT set_active_branch($1)', [main]));
    const before = (await db.query('SELECT id,is_voided,branch_id FROM sales ORDER BY id')).rows;
    await expect(asUser(owner, () => db.query('SELECT void_sale($1,$2)', [saleWarehouse, 'Wrong branch']))).rejects.toThrow('record branch access denied');
    await expect(asUser(owner, () => db.query('SELECT process_return($1::jsonb)', [JSON.stringify({ saleId: saleWarehouse, reason: 'Wrong branch', items: [] })]))).rejects.toThrow('record branch access denied');
    await db.query("INSERT INTO sale_submissions(shop_id,idempotency_key,sale_id) VALUES($1,'branch-retry-fixture',$2)", [tenant, saleWarehouse]);
    await expect(asUser(owner, () => db.query('SELECT create_sale($1::jsonb)', [JSON.stringify({ idempotencyKey: 'branch-retry-fixture' })]))).rejects.toThrow('another branch or record');
    expect((await db.query('SELECT id,is_voided,branch_id FROM sales ORDER BY id')).rows).toEqual(before);
  });
  it('Activity RPC reads selected branch audit events and immutable person/role labels', async () => {
    await asUser(owner, () => db.query('SELECT set_active_branch($1)', [warehouse]));
    const feed = await asUser(owner, () => db.query('SELECT * FROM get_branch_activity()'));
    expect(feed.rows.length).toBeGreaterThan(0);
    expect(feed.rows.every((row: any) => row.branch_id === warehouse)).toBe(true);
    expect(feed.rows.some((row: any) => row.action === 'branch_selected' && row.actor_id === owner && row.actor_name === 'Fixture Owner' && row.actor_role === 'owner')).toBe(true);
    await expect(asUser(mainUser, () => db.query('SELECT * FROM get_branch_activity()'))).rejects.toThrow('missing permission activity.view');
    await asUser(owner, () => db.query('SELECT set_active_branch($1)', [main]));
  });
  it('an access manager cannot widen branch scope or grant permissions above their own authority', async () => {
    const managerRole = 'e1940000-0000-0000-0000-000000000001';
    await db.query("INSERT INTO roles(id,tenant_id,name) VALUES($1,$2,'Scoped manager')", [managerRole, tenant]);
    await db.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code='employees.manage'", [managerRole]);
    await db.query('UPDATE memberships SET role_id=$1 WHERE user_id=$2', [managerRole, mainUser]);
    await expect(asUser(mainUser, () => db.query('SELECT update_employee_access($1::jsonb)', [JSON.stringify({ employeeId: warehouseUser, roleId: saleRole, branchScope: [main] })]))).rejects.toThrow('exceeds your branch scope');
    await expect(asUser(mainUser, () => db.query('SELECT update_employee_access($1::jsonb)', [JSON.stringify({ employeeId: mainUser, branchScope: [main, warehouse] })]))).rejects.toThrow('exceeds your branch scope');
    await expect(asUser(mainUser, () => db.query('SELECT assign_employee_branch($1,$2,$3)', [warehouseUser, main, 'move']))).rejects.toThrow('assignment exceeds editor scope');
    await expect(asUser(owner, () => db.query('SELECT update_employee_access($1::jsonb)', [JSON.stringify({ employeeId: mainUser, branchScope: null })]))).rejects.toThrow('explicit branches');
    await db.query('UPDATE memberships SET role_id=$1 WHERE user_id=$2', [saleRole, mainUser]);
  });
  it('revoked view permission hides direct reads and a legacy admin label no longer grants all permissions', async () => {
    await db.query('DELETE FROM role_permissions WHERE role_id=$1 AND permission_id IN (SELECT id FROM permissions WHERE code=$2)', [saleRole, 'sales.view']);
    expect(await visibleSales(mainUser)).toEqual([]);
    await db.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code='sales.view'", [saleRole]);
    await db.query("UPDATE memberships SET role='admin' WHERE user_id=$1", [mainUser]);
    const permissions = await asUser(mainUser, () => db.query('SELECT get_my_permissions() permissions'));
    expect((permissions.rows[0] as any).permissions).not.toContain('employees.manage');
    await expect(asUser(mainUser, () => db.query('SELECT assign_employee_branch($1,$2,$3)', [warehouseUser, main, 'move']))).rejects.toThrow('missing permission employees.manage');
    await db.query("UPDATE memberships SET role='employee' WHERE user_id=$1", [mainUser]);
    await expect(asUser(owner, () => db.query("INSERT INTO sales(sale_number) VALUES('BYPASS')"))).rejects.toThrow('permission denied');
  });
  it('replays the migration a second time without changing historical ownership', async () => {
    const before = (await db.query('SELECT id,branch_id FROM sales ORDER BY id')).rows;
    for (const sql of splitStatements(fs.readFileSync('supabase/migrations/0188_a_branch_is_not_its_tenant.sql', 'utf8'))) await db.exec(sql);
    expect((await db.query('SELECT id,branch_id FROM sales ORDER BY id')).rows).toEqual(before);
    expect((await branches(mainUser)).map(r => r.branch_id)).toEqual([main]);
  });
});

suite('branch responsibility is operational control, never business ownership — executed SQL', () => {
  it('a non-owner cannot assign responsibility, not even in their own branch', async () => {
    await expect(asUser(warehouseUser, async () => {
      await db.query('SELECT public.grant_branch_responsibility($1,$2)', [warehouse, multiUser]);
    })).rejects.toThrow(/NOT_AUTHORIZED/);
  });
  it('the owner assigns Warehouse and the trail records actor, branch and before/after', async () => {
    const result = await asUser(owner, async () =>
      (await db.query('SELECT public.grant_branch_responsibility($1,$2) AS r', [warehouse, warehouseUser])).rows[0].r as any);
    expect(result.success).toBe(true);
    const audit = (await db.query(
      "SELECT user_id, branch_id, details FROM public.audit_events WHERE action='branch_responsibility_granted'")).rows as Array<any>;
    expect(audit.length).toBe(1);
    expect(audit[0].user_id).toBe(owner);
    expect(audit[0].branch_id).toBe(warehouse);
    expect(audit[0].details.before.responsible_user_id).toBeNull();
    expect(audit[0].details.after.responsible_user_id).toBe(warehouseUser);
    expect(audit[0].details.businessOwnershipUnchanged).toBe(true);
  });
  it('being responsible for Warehouse grants nothing in Main', async () => {
    expect((await branches(warehouseUser)).map((r: any) => r.branch_id)).toEqual([warehouse]);
    // Asserted as isolation rather than as an exact list: earlier cases in this file also write
    // Warehouse sales, so the set is not fixed here. What must hold is that the Warehouse holder
    // sees Warehouse rows and never the Main one.
    const visible = (await visibleSales(warehouseUser)) as Array<any>;
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((r: any) => r.branch_id === warehouse)).toBe(true);
    expect(visible.map((r: any) => r.id)).toContain(saleWarehouse);
    expect(visible.map((r: any) => r.id)).not.toContain(saleMain);
  });
  it('a second responsible person is refused and pointed at transfer', async () => {
    await expect(asUser(owner, async () => {
      await db.query('SELECT public.grant_branch_responsibility($1,$2)', [warehouse, multiUser]);
    })).rejects.toThrow(/BRANCH_ALREADY_ASSIGNED/);
  });
  it('a branch belonging to another business can never be assigned', async () => {
    await expect(asUser(owner, async () => {
      await db.query('SELECT public.grant_branch_responsibility($1,$2)', [foreign, multiUser]);
    })).rejects.toThrow(/BRANCH_NOT_FOUND/);
  });
  it('transfer hands over atomically, leaving exactly one active holder and a recorded end', async () => {
    await asUser(owner, async () => {
      await db.query('SELECT public.transfer_branch_responsibility($1,$2,$3,$4)', [warehouse, multiUser, null, 'handover']);
    });
    const active = (await db.query(
      'SELECT user_id FROM public.branch_responsibility WHERE branch_id=$1 AND revoked_at IS NULL', [warehouse])).rows as Array<any>;
    expect(active.map((r: any) => r.user_id)).toEqual([multiUser]);
    const ended = (await db.query(
      'SELECT user_id, revoked_by FROM public.branch_responsibility WHERE branch_id=$1 AND revoked_at IS NOT NULL', [warehouse])).rows as Array<any>;
    expect(ended.map((r: any) => r.user_id)).toEqual([warehouseUser]);
    expect(ended[0].revoked_by).toBe(owner);
  });
  it('revoking ends the designation and leaves the branch, its staff and its history intact', async () => {
    await asUser(owner, async () => {
      await db.query('SELECT public.revoke_branch_responsibility($1,$2)', [warehouse, 'manager left']);
    });
    const active = (await db.query(
      'SELECT count(*)::int AS c FROM public.branch_responsibility WHERE branch_id=$1 AND revoked_at IS NULL', [warehouse])).rows[0] as any;
    expect(active.c).toBe(0);
    const recorded = (await db.query(
      'SELECT count(*)::int AS c FROM public.branch_responsibility WHERE branch_id=$1', [warehouse])).rows[0] as any;
    expect(recorded.c).toBe(2);
    const sale = (await db.query('SELECT count(*)::int AS c FROM public.sales WHERE id=$1', [saleWarehouse])).rows[0] as any;
    expect(sale.c).toBe(1);
  });
  it('revoking requires a stated reason', async () => {
    await asUser(owner, async () => {
      await db.query('SELECT public.grant_branch_responsibility($1,$2)', [warehouse, warehouseUser]);
    });
    await expect(asUser(owner, async () => {
      await db.query('SELECT public.revoke_branch_responsibility($1,$2)', [warehouse, '   ']);
    })).rejects.toThrow(/VALIDATION/);
  });
  it('the responsible person reads back for a branch the caller may see', async () => {
    const person = await asUser(owner, async () =>
      (await db.query('SELECT public.branch_responsible_person($1) AS r', [warehouse])).rows[0].r as any);
    expect(person.user_id).toBe(warehouseUser);
  });
});
