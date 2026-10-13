import { test, expect } from '@playwright/test';

// UI contract evidence only. Every remote request is intercepted; this test does not impersonate
// a live QA session and does not claim database/API enforcement. What it proves is narrower and
// still worth proving: that the screens send the handover to the right RPC with the right
// arguments, that keeping a branch issues no handover at all, and that the refusal copy is the
// one the store maps to a named code rather than a generic failure.
const tenant = 'e1990000-0000-0000-0000-000000000001';
const main = 'e1990000-0000-0000-0000-000000000011';
const warehouse = 'e1990000-0000-0000-0000-000000000012';
const owner = 'e1990000-0000-0000-0000-000000000021';
const ahmed = 'e1990000-0000-0000-0000-000000000022';
const bilal = 'e1990000-0000-0000-0000-000000000023';

for (const language of ['en', 'ur'] as const) {
  test(`branch responsibility is handed over, transferred and taken back (${language}; mocked transport)`, async ({ page }) => {
    let activeBranch = main;
    let createdBranch: string | null = null;
    let responsible: string | null = null;
    const lifecycleCalls: Record<string, unknown>[] = [];

    await page.route('https://*.supabase.co/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const name = url.pathname.split('/').pop();
      let data: unknown = [];
      if (url.pathname.includes('/rpc/')) {
        const body = request.postDataJSON();
        if (name === 'get_my_shops') data = [{ shop_id: tenant, name: 'Fixture Business', membership_role: 'owner', membership_status: 'active', is_current: true }];
        if (name === 'get_my_permissions') data = ['employees.manage', 'employees.view', 'activity.view', 'settings.edit'];
        if (name === 'get_my_branches') data = [
          { branch_id: main, tenant_id: tenant, name: 'Main', membership_role: 'owner', membership_status: 'active', is_current: activeBranch === main, is_main: true },
          { branch_id: warehouse, tenant_id: tenant, name: 'Warehouse', membership_role: 'owner', membership_status: 'active', is_current: activeBranch === warehouse, is_main: false },
          ...(createdBranch ? [{ branch_id: createdBranch, tenant_id: tenant, name: 'New Branch', membership_role: 'owner', membership_status: 'active', is_current: activeBranch === createdBranch, is_main: false }] : []),
        ];
        if (name === 'create_operating_branch') {
          lifecycleCalls.push({ rpc: name, ...body });
          createdBranch = body.p_branch_id;
          data = { success: true, branch_id: createdBranch, tenant_id: tenant, branch_name: 'New Branch' };
        }
        // Who runs a branch. Read fresh on every visit, so the screen cannot show a stale answer.
        if (name === 'branch_responsible_person') data = responsible ? { user_id: responsible, name: responsible === ahmed ? 'Ahmed Fixture' : 'Bilal Fixture' } : null;
        if (name === 'grant_branch_responsibility') {
          lifecycleCalls.push({ rpc: name, ...body });
          responsible = body.p_user_id;
          data = { success: true, branch_id: body.p_branch_id, user_id: body.p_user_id };
        }
        if (name === 'transfer_branch_responsibility') {
          lifecycleCalls.push({ rpc: name, ...body });
          responsible = body.p_to_user_id;
          data = { success: true, branch_id: body.p_branch_id, from_user_id: ahmed, to_user_id: body.p_to_user_id };
        }
        if (name === 'revoke_branch_responsibility') {
          lifecycleCalls.push({ rpc: name, ...body });
          responsible = null;
          data = { success: true, branch_id: body.p_branch_id, access_kept: true };
        }
        if (name === 'set_active_branch') {
          activeBranch = body.p_branch_id;
          data = { success: true, branch_id: activeBranch, tenant_id: tenant, branch_name: activeBranch === main ? 'Main' : activeBranch === createdBranch ? 'New Branch' : 'Warehouse', membership_role: 'owner' };
        }
        if (name === 'get_branch_activity') data = [];
        if (name === 'get_employee_access') data = { roleId: null, membershipRole: 'employee', branchScope: [main], defaults: [], overrides: {}, effective: [] };
      } else if (name === 'users') {
        data = [
          { id: ahmed, name: 'Ahmed Fixture', phone: '923019900002', role: 'employee', is_active: true, is_original_owner: false, created_at: '2026-10-05T00:00:00Z' },
          { id: bilal, name: 'Bilal Fixture', phone: '923019900003', role: 'employee', is_active: true, is_original_owner: false, created_at: '2026-10-05T00:00:00Z' },
        ];
      } else if (name === 'memberships') {
        data = [
          { user_id: ahmed, status: 'active', branch_scope: [warehouse], role_id: null },
          { user_id: bilal, status: 'active', branch_scope: [warehouse], role_id: null },
        ];
      } else if (name === 'branches') {
        data = [{ id: main, name: 'Main', is_default: true }, { id: warehouse, name: 'Warehouse', is_default: false }];
      }
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/1' }, body: JSON.stringify(data) });
    });

    await page.addInitScript(({ language, tenant, owner }) => {
      localStorage.setItem('agri_auth', JSON.stringify({ state: { user: {
        id: owner, name: 'Fixture Owner', phone: '923019900001', role: 'admin',
        isOriginalOwner: true, isActive: true, tenantId: tenant, membershipRole: 'owner',
        membershipStatus: 'active', firstLoginAt: '2026-10-04T00:00:00Z',
      } }, version: 0 }));
      localStorage.setItem('agrishop-theme', JSON.stringify({ state: { language, theme: 'light' }, version: 0 }));
    }, { language, tenant, owner });
    await page.setViewportSize({ width: 390, height: 844 });

    // ── 1. creating a branch and handing it over in the same act ───────────────
    await page.goto('/admin/settings/profile');
    await page.getByTestId('branches-create').click();
    await expect(page.getByTestId('setup-step-1')).toBeVisible();
    await page.getByTestId('shop-name-input').fill('New Branch');
    await page.evaluate(async () => {
      const { useShopStore } = await import('/src/stores/shopStore.ts');
      useShopStore.getState().setSetupDraft({ place: { lat: 31.52, lng: 74.35, label: 'Lahore', address: 'Fixture address', source: 'openstreetmap', countryCode: 'pk' } });
    });
    await page.getByTestId('setup-continue').click();
    await expect(page.getByTestId('setup-step-2')).toBeVisible();
    await page.getByTestId('ownership-assign').click();
    await page.getByTestId(`assign-person-${ahmed}`).click();
    await page.getByTestId('setup-create-shop').click();
    await expect(page.getByTestId('setup-step-3')).toBeVisible();
    expect(lifecycleCalls.map(c => c.rpc)).toEqual(['create_operating_branch', 'grant_branch_responsibility']);
    expect(lifecycleCalls[1]).toMatchObject({ p_branch_id: createdBranch, p_user_id: ahmed });

    // ── 2. keeping a branch hands over nothing ────────────────────────────────
    lifecycleCalls.length = 0;
    await page.goto('/admin/settings/profile');
    await page.getByTestId('branches-create').click();
    await page.getByTestId('shop-name-input').fill('Second Branch');
    await page.evaluate(async () => {
      const { useShopStore } = await import('/src/stores/shopStore.ts');
      useShopStore.getState().setSetupDraft({ place: { lat: 31.52, lng: 74.35, label: 'Lahore', address: 'Fixture address', source: 'openstreetmap', countryCode: 'pk' } });
    });
    await page.getByTestId('setup-continue').click();
    await page.getByTestId('ownership-keep').click();
    await page.getByTestId('setup-create-shop').click();
    await expect(page.getByTestId('setup-step-3')).toBeVisible();
    expect(lifecycleCalls.map(c => c.rpc)).toEqual(['create_operating_branch']);

    // ── 3. the branch page shows who runs it, and hands it over ───────────────
    responsible = ahmed;
    lifecycleCalls.length = 0;
    await page.goto(`/admin/settings/branches/${warehouse}`);
    await expect(page.getByTestId(`branch-responsible-${warehouse}`)).toContainText('Ahmed Fixture');
    await page.getByTestId(`branch-handover-${warehouse}`).click();
    // The current holder is not offered as their own replacement.
    await expect(page.getByTestId(`handover-person-${ahmed}`)).toHaveCount(0);
    await page.getByTestId(`handover-person-${bilal}`).click();
    await page.getByTestId('confirm-submit').click();
    await expect.poll(() => lifecycleCalls.length).toBe(1);
    expect(lifecycleCalls[0]).toMatchObject({ rpc: 'transfer_branch_responsibility', p_branch_id: warehouse, p_to_user_id: bilal });
    await expect(page.getByTestId(`branch-responsible-${warehouse}`)).toContainText('Bilal Fixture');

    // ── 4. taking responsibility back requires a reason ───────────────────────
    lifecycleCalls.length = 0;
    await page.getByTestId(`branch-revoke-${warehouse}`).click();
    await expect(page.getByTestId('confirm-submit')).toBeDisabled();
    await page.locator('input[maxlength="500"]').fill('Handed back to the owner');
    await page.getByTestId('confirm-submit').click();
    await expect.poll(() => lifecycleCalls.length).toBe(1);
    expect(lifecycleCalls[0]).toMatchObject({ rpc: 'revoke_branch_responsibility', p_branch_id: warehouse, p_reason: 'Handed back to the owner' });
    await expect(page.getByTestId(`branch-revoke-${warehouse}`)).toHaveCount(0);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: `.freebuff/branch-responsibility-${language}.png` });
  });
}
