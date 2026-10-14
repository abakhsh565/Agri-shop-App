import { test, expect } from '@playwright/test';
import { seedShopDraft } from './helpers';

// UI contract evidence only. Every remote request is intercepted; this test
// does not impersonate a live QA session or claim database/API enforcement.
const tenant = 'e1980000-0000-0000-0000-000000000001';
const main = 'e1980000-0000-0000-0000-000000000011';
const warehouse = 'e1980000-0000-0000-0000-000000000012';
const owner = 'e1980000-0000-0000-0000-000000000021';
const employee = 'e1980000-0000-0000-0000-000000000022';
const role = 'e1980000-0000-0000-0000-000000000041';

for (const language of ['en', 'ur'] as const) {
  test(`existing employee Add and Move are explicit, confirmed, and carry branch not tenant (${language}; mocked transport)`, async ({ page }) => {
    let activeBranch = warehouse;
    const calls: Record<string, unknown>[] = [];
    const lifecycleCalls: Record<string, unknown>[] = [];
    let createdBranch: string | null = null;
    await page.route('https://*.supabase.co/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const name = url.pathname.split('/').pop();
      let data: unknown = [];
      if (url.pathname.includes('/rpc/')) {
        const body = request.postDataJSON();
        if (name === 'get_my_shops') data = [{ shop_id: tenant, name: 'Fixture Business', membership_role: 'owner', membership_status: 'active', is_current: true }];
        if (name === 'get_my_permissions') data = ['employees.manage', 'employees.view', 'sales.view', 'activity.view', 'settings.edit'];
        if (name === 'get_my_branches') data = [
          { branch_id: main, tenant_id: tenant, name: 'Main', membership_role: 'owner', membership_status: 'active', is_current: activeBranch === main, is_main: true },
          { branch_id: warehouse, tenant_id: tenant, name: 'Warehouse', membership_role: 'owner', membership_status: 'active', is_current: activeBranch === warehouse, is_main: false },
          ...(createdBranch ? [{ branch_id: createdBranch, tenant_id: tenant, name: 'New Branch', membership_role: 'owner', membership_status: 'active', is_current: activeBranch === createdBranch, is_main: false }] : []),
        ];
        if (name === 'create_operating_branch') {
          lifecycleCalls.push({ rpc: name, ...body }); createdBranch = body.p_branch_id;
          data = { success: true, branch_id: createdBranch, tenant_id: tenant, branch_name: 'New Branch' };
        }
        if (name === 'get_branch_activity') data = [{ id: 'audit-fixture', action: 'sale_created', entity_type: 'sale', entity_id: 'sale-fixture',
          actor_id: owner, actor_name: 'Fixture Owner', actor_role: 'owner', branch_id: activeBranch, branch_name: activeBranch === createdBranch ? 'New Branch' : 'Warehouse',
          details: { result: 'succeeded' }, created_at: '2026-10-05T00:00:00Z' }];
        if (name === 'archive_operating_branch') {
          lifecycleCalls.push({ rpc: name, ...body }); createdBranch = null; activeBranch = main;
          data = { success: true, history_preserved: true, fallback_branch_id: main };
        }
        if (name === 'set_active_branch') {
          activeBranch = body.p_branch_id;
          data = { success: true, branch_id: activeBranch, tenant_id: tenant, branch_name: activeBranch === main ? 'Main' : activeBranch === createdBranch ? 'New Branch' : 'Warehouse', membership_role: 'owner' };
        }
        if (name === 'assign_employee_branch') {
          calls.push(body);
          data = { id: employee, branchScope: [warehouse], changed: true };
        }
        if (name === 'get_employee_access') data = { roleId: role, membershipRole: 'employee', branchScope: [main], defaults: [], overrides: {}, effective: [] };
      } else if (name === 'users') {
        data = [{ id: employee, name: 'Existing Fixture', phone: '923019800002', role: 'employee', is_active: true, is_original_owner: false, created_at: '2026-10-05T00:00:00Z' }];
      } else if (name === 'memberships') {
        data = [{ user_id: employee, status: 'active', branch_scope: [main], role_id: role }];
      } else if (name === 'branches') {
        data = [{ id: main, name: 'Main', is_default: true }, { id: warehouse, name: 'Warehouse', is_default: false }];
      } else if (name === 'roles') {
        data = [{ id: role, tenant_id: tenant, name: 'Sales fixture', is_system: false, created_at: '2026-10-05T00:00:00Z' }];
      }
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/1' }, body: JSON.stringify(data) });
    });
    await page.addInitScript(({ language, tenant, owner }) => {
      localStorage.setItem('agri_auth', JSON.stringify({ state: { user: {
        id: owner, name: 'Fixture Owner', phone: '923019800001', role: 'admin',
        isOriginalOwner: true, isActive: true, tenantId: tenant, membershipRole: 'owner',
        membershipStatus: 'active', firstLoginAt: '2026-10-04T00:00:00Z',
      } }, version: 0 }));
      localStorage.setItem('agrishop-theme', JSON.stringify({ state: { language, theme: 'light' }, version: 0 }));
    }, { language, tenant, owner });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/employees/new');
    await page.getByTestId('employee-mode-existing').click();
    await page.getByTestId(`existing-employee-${employee}`).click();
    await page.getByTestId('employee-branch-add').click();
    await expect(page.getByTestId('confirm-submit')).toBeVisible();
    expect(calls).toHaveLength(0);
    await page.getByTestId('confirm-cancel').click();
    expect(calls).toHaveLength(0);
    await page.getByTestId('employee-branch-add').click();
    await page.getByTestId('confirm-submit').click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toEqual({ p_employee_id: employee, p_branch_id: warehouse, p_action: 'add' });
    await page.goto('/admin/employees/new');
    await page.getByTestId('employee-mode-existing').click();
    await page.getByTestId(`existing-employee-${employee}`).click();
    await page.getByTestId('employee-branch-move').click();
    await page.getByTestId('confirm-submit').click();
    await expect.poll(() => calls.length).toBe(2);
    expect(calls[1]).toEqual({ p_employee_id: employee, p_branch_id: warehouse, p_action: 'move' });
    await page.goto('/admin/settings/profile');
    await expect(page.getByTestId(`branch-row-${warehouse}`)).toBeVisible();
    await expect(page.getByTestId(`branch-row-${main}`)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId(`branch-row-${warehouse}`)).toBeVisible();
    await expect(page.getByTestId('profile-details-card')).toContainText('Fixture Owner');
    await expect(page.getByTestId('profile-working-branch')).toContainText('Warehouse');
    await page.getByTestId('branches-create').click();
    await expect(page.getByTestId('setup-step-1')).toBeVisible();
    await page.getByTestId('shop-name-input').fill('New Branch');
    // Same guard as before, one step earlier: the flow cannot advance to ownership until the
    // name and the location are both supplied. Ownership is chosen next, then the branch is
    // created — so "create" is reached only with a complete, deliberate answer.
    await expect(page.getByTestId('setup-continue')).toBeDisabled();
    // The map picker itself has a separate lane. Supply its completed place via
    // the real shared draft owner, then exercise the user-visible continue action.
    await seedShopDraft(
      page,
      { place: { lat: 31.52, lng: 74.35, label: 'Lahore', address: 'Fixture address', source: 'openstreetmap', countryCode: 'pk' } },
      () => page.getByTestId('setup-continue').isEnabled(),
    );
    await page.getByTestId('setup-continue').click();
    await expect(page.getByTestId('setup-step-2')).toBeVisible();
    // Keeping the branch is the default, and it must still create the branch under the owner
    // without issuing any responsibility call — asserted below by the lifecycle call count.
    await expect(page.getByTestId('ownership-keep')).toBeVisible();
    await page.getByTestId('ownership-keep').click();
    // Name, location and an ownership answer are all present, so creation is now possible.
    await expect(page.getByTestId('setup-create-shop')).toBeEnabled();
    await page.getByTestId('setup-create-shop').click();
    await expect(page.getByTestId('setup-step-3')).toBeVisible();
    expect(lifecycleCalls).toHaveLength(1);
    expect(lifecycleCalls[0]).toMatchObject({ rpc: 'create_operating_branch', p_name: 'New Branch', p_latitude: 31.52, p_longitude: 74.35 });
    expect(lifecycleCalls[0]).not.toHaveProperty('p_role_ids');
    const newBranch = String(lifecycleCalls[0].p_branch_id);
    expect(newBranch).not.toBe(tenant);
    await page.getByTestId('setup-finish').click();
    await page.goto('/admin/activity');
    await expect(page.getByTestId('audit-event-audit-fixture')).toContainText('Fixture Owner');
    await expect(page.getByTestId('audit-event-audit-fixture')).toContainText('New Branch');
    await page.reload();
    await expect(page.getByTestId('audit-event-audit-fixture')).toBeVisible();
    await page.screenshot({ path: `.freebuff/branch-audit-${language}.png` });
    await page.goto(`/admin/settings/branches/${newBranch}`);
    await page.getByTestId(`branch-delete-action-${newBranch}`).click();
    await expect(page.getByTestId('confirm-submit')).toBeDisabled();
    await page.getByTestId('confirm-cancel').click();
    expect(lifecycleCalls).toHaveLength(1);
    await page.getByTestId(`branch-delete-action-${newBranch}`).click();
    await page.locator('input[maxlength="500"]').fill('Fixture no longer needed');
    await page.getByTestId('confirm-submit').click();
    await expect.poll(() => lifecycleCalls.length).toBe(2);
    expect(lifecycleCalls[1]).toEqual({ rpc: 'archive_operating_branch', p_branch_id: newBranch, p_reason: 'Fixture no longer needed' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: `.freebuff/branch-corrections-${language}.png` });
  });
}
