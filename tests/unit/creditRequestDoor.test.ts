/**
 * A credit-limit request must be answerable from the app, and it must be visible while it waits.
 *
 * WHY A GUARD. This flow failed twice in ways that produced no error anywhere:
 *
 *   1. The Action Center's "Review" for a pending request sent the owner to the CUSTOMER PAGE.
 *      That page shows the limit on record and says nothing about the request, so the only screen
 *      that can approve a figure the employee did not ask for — the request detail (0251) — was
 *      unreachable from the UI. The signal carries the customer, not the request, so the request
 *      id travels in the signal id: the prefix is asserted here so the mapping and the card cannot
 *      drift apart.
 *   2. Nothing on the customer card or the sale screen said a request was waiting. The employee
 *      could not tell whether their request had gone anywhere and could file the same request
 *      twice; the owner, opening the same card, saw nothing to act on.
 *
 * The route itself (`alerts/credit-requests/:requestId`) is asserted to still exist in the router,
 * because a screen nothing links to is the same dead end in a different shape.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8');

const alerts = read('src/pages/admin/alerts/RemindersOverviewPage.tsx');
const customerCard = read('src/pages/employee/customers/CustomerProfilePage.tsx');
const cart = read('src/pages/employee/sale/CartPage.tsx');
const routerSource = read('src/router/index.tsx');

describe('Credit-limit requests are visible and answerable', () => {
  it('keeps a routable screen for a request', () => {
    expect(routerSource).toContain('alerts/credit-requests/:requestId');
  });

  it('sends the owner to the request itself, not the customer profile', () => {
    // The prefix is named once, so the mapping that builds the signal and the card that opens it
    // share it. A second literal would silently stop matching.
    expect(alerts).toMatch(/const CREDIT_REQUEST_SIGNAL_PREFIX = "credit-request-";/);
    expect(alerts).toMatch(/id: `\$\{CREDIT_REQUEST_SIGNAL_PREFIX\}\$\{r\.id\}`/);

    const requestBranch = alerts.indexOf('const requestId = creditRequestIdOf(signal.id);');
    const profileBranch = alerts.indexOf('navigateToCustomer(signal.entity_id)');
    expect(requestBranch).toBeGreaterThan(-1);
    expect(profileBranch).toBeGreaterThan(-1);
    expect(
      requestBranch,
      'a credit request is now opened as the customer profile again — the screen that can approve a different amount becomes unreachable',
    ).toBeLessThan(profileBranch);
    expect(alerts).toContain('navigate(`/admin/alerts/credit-requests/${requestId}`)');
  });

  it('shows the waiting request on the customer card, and re-reads it after sending', () => {
    expect(customerCard).toContain('getCreditRequestsDB');
    expect(customerCard).toMatch(/r\.status === "pending"/);
    expect(customerCard).toContain('creditLimit.requestPending');
    // After a request is filed the card must re-read the row: without this the button stayed on
    // screen and the employee could file the same request again.
    const send = customerCard.indexOf('await requestCreditLimitIncrease(');
    const reread = customerCard.indexOf('await loadPendingLimitRequest();', send);
    expect(send).toBeGreaterThan(-1);
    expect(
      reread,
      'the card no longer re-reads the pending request after sending one — a second request can be filed',
    ).toBeGreaterThan(send);
  });

  it('does not offer a second request while one is waiting', () => {
    // The customer card: the request button is inside a `!pendingLimitRequest &&` guard.
    expect(customerCard).toMatch(/!pendingLimitRequest &&/);
    // The sale screen must not lag behind it.
    expect(cart).toContain('getCreditRequestsDB');
    expect(cart).toMatch(/!canSetCreditLimit && pendingLimitRequest \?/);
  });
});
