import { test, expect } from './base';

// UI contract evidence only. Every remote request is intercepted; this test does not
// impersonate a live QA session and does not claim database/RLS enforcement.
//
// What it exists to catch: the screen's branch tabs filtered `n.shop_id === branch.id`, i.e. a
// *business* id compared against a *branch* id. The two id spaces never meet, so every branch
// tab was empty and told the owner that branch was quiet while the rows sat on the tab next to
// it. A fixture where the business id and a branch id are the same string would hide that, so
// these are deliberately different values.
const tenant = 'e1970000-0000-0000-0000-000000000001';
const main = 'e1970000-0000-0000-0000-000000000011';
const warehouse = 'e1970000-0000-0000-0000-000000000012';
const owner = 'e1970000-0000-0000-0000-000000000021';

const now = new Date().toISOString();

const rows = [
  { id: 'n-main', kind: 'sale', title: 'New sale 1001', body: 'Ahmed sold rice', shop_id: tenant, branch_id: main,
    entity_id: 'e1970000-0000-0000-0000-0000000000a1', actor_id: owner, actor_name: 'Fixture Owner', read: false, created_at: now },
  { id: 'n-warehouse', kind: 'sale', title: 'New sale 1002', body: 'Ahmed sold wheat', shop_id: tenant, branch_id: warehouse,
    entity_id: 'e1970000-0000-0000-0000-0000000000a2', actor_id: owner, actor_name: 'Fixture Owner', read: false, created_at: now },
  { id: 'n-unattributed', kind: 'low_stock', title: 'Low stock: Sugar', body: 'Sugar has 3 left', shop_id: tenant, branch_id: null,
    entity_id: 'e1970000-0000-0000-0000-0000000000b1', actor_id: owner, actor_name: 'Fixture Owner', read: false, created_at: now },
];

for (const language of ['en', 'ur'] as const) {
  test(`branch tabs read branch ids, name the branch, and never claim an unattributed row (${language}; mocked transport)`, async ({ page }) => {
    const readBodies: string[] = [];

    await page.addInitScript(({ language, tenant, owner }) => {
      localStorage.setItem('agri_auth', JSON.stringify({ state: { user: {
        id: owner, name: 'Fixture Owner', phone: '923019800010', role: 'admin',
        isOriginalOwner: true, isActive: true, tenantId: tenant, membershipRole: 'owner',
        membershipStatus: 'active', firstLoginAt: '2026-10-04T00:00:00Z',
      } }, version: 0 }));
      localStorage.setItem('agrishop-theme', JSON.stringify({ state: { language, theme: 'light' }, version: 0 }));
    }, { language, tenant, owner });

    await page.route('https://*.supabase.co/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const name = url.pathname.split('/').pop();
      let data: unknown = [];

      if (url.pathname.includes('/rpc/')) {
        if (name === 'get_my_shops') data = [{ shop_id: tenant, name: 'Fixture Business', membership_role: 'owner', membership_status: 'active', is_current: true }];
        if (name === 'get_my_permissions') data = ['notifications.view', 'settings.edit'];
        if (name === 'get_my_branches') data = [
          { branch_id: main, tenant_id: tenant, name: 'Main', membership_role: 'owner', membership_status: 'active', is_current: true, is_main: true },
          { branch_id: warehouse, tenant_id: tenant, name: 'Warehouse', membership_role: 'owner', membership_status: 'active', is_current: false, is_main: false },
        ];
      } else if (name === 'notifications') {
        // The rows being marked are named in the query string (`.in("id", ids)`), not the body.
        if (request.method() === 'PATCH') readBodies.push(request.url());
        else data = rows;
      }

      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-2/3' }, body: JSON.stringify(data) });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/notifications');

    // One tab per branch, plus the all-branches view.
    const tabs = page.getByTestId('notifications-branch-tabs');
    await expect(tabs).toBeVisible();
    await expect(page.getByTestId(`notifications-tab-${main}`)).toBeVisible();
    await expect(page.getByTestId(`notifications-tab-${warehouse}`)).toBeVisible();

    const row = (id: string) => page.getByTestId(`notification-${id}`);

    // The all-branches view: everything, and every attributed row says WHERE it happened —
    // which is the one fact a row on this screen is otherwise missing.
    await expect(row('n-main')).toBeVisible();
    await expect(row('n-warehouse')).toBeVisible();
    await expect(row('n-unattributed')).toBeVisible();
    await expect(page.getByText(/Main ·/, { exact: false })).toBeVisible();
    await expect(page.getByText(/Warehouse ·/, { exact: false })).toBeVisible();
    await expect(tabs).toContainText('3');

    // The Main tab: its own row, and NOT the other branch's. This is the assertion that
    // fails against the old `shop_id === branch.id` comparison, where both were empty.
    await page.getByTestId(`notifications-tab-${main}`).click();
    await expect(row('n-main')).toBeVisible();
    await expect(row('n-warehouse')).toHaveCount(0);
    // A row the database never attributed belongs to no branch, so it is not claimed here.
    await expect(row('n-unattributed')).toHaveCount(0);
    // On a branch tab the branch is not repeated on every row: they are all that branch.
    await expect(page.getByText(/Main ·/, { exact: false })).toHaveCount(0);

    // The Warehouse tab is the mirror image, so the first one passing cannot be luck.
    await page.getByTestId(`notifications-tab-${warehouse}`).click();
    await expect(row('n-warehouse')).toBeVisible();
    await expect(row('n-main')).toHaveCount(0);

    // Marking read from a branch tab marks THAT branch: clearing a badge the owner never
    // looked at is losing work rather than doing any.
    await page.getByTestId('notifications-mark-read').click();
    await expect.poll(() => readBodies.length).toBe(1);
    expect(decodeURIComponent(readBodies[0])).toContain('n-warehouse');
    expect(decodeURIComponent(readBodies[0])).not.toContain('n-main');
    expect(decodeURIComponent(readBodies[0])).not.toContain('n-unattributed');
  });
}
