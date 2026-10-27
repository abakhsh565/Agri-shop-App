/**
 * The grants an employee's device holds must be re-read from the server, and a call that could
 * not be answered must change nothing.
 *
 * WHY A GUARD. The failure this prevents is silent in both directions. An owner ticks
 * "Add Product" (or unticks "change a customer's credit limit") in the database, and the
 * employee's open phone keeps rendering the snapshot taken at sign-in — so the owner is told the
 * permission was given while the employee's screen still hides it, and a revoked permission keeps
 * inviting an action the server has stopped accepting. Nothing errors; the two sides simply
 * disagree. The other half matters just as much: if the refresh wrote whatever came back even when
 * the call failed, a flaky rural connection would strip every grant on the device and lock the
 * employee out of their own shop, so the error path is asserted to return BEFORE any write.
 *
 * WHAT IS BEING GUARDED, layer by layer:
 *   • the resolver (`get_my_permissions`) is still what the app asks — identity is not authority;
 *   • `refreshPermissions` exists on the store and is reachable from the app shell;
 *   • launch AND returning to the foreground both trigger it, because a counter phone stays open
 *     all day and would otherwise never see a later change;
 *   • a failed read is a no-op, not a revocation.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const AUTH_STORE = path.resolve(process.cwd(), 'src/stores/authStore.ts');
const APP = path.resolve(process.cwd(), 'src/App.tsx');

const store = fs.readFileSync(AUTH_STORE, 'utf-8');
const app = fs.readFileSync(APP, 'utf-8');

describe('Permission freshness on an open device', () => {
  it('re-reads the grants from the server resolver, not from the stored snapshot', () => {
    expect(store).toContain('refreshPermissions');
    expect(store).toMatch(/supabase\.rpc\("get_my_permissions"\)/);
  });

  it('changes nothing when the server could not be asked', () => {
    // The refusal must sit before the write. A guard that wrote an empty answer on a failed
    // call would revoke every permission the moment the device went offline.
    const refusal = store.indexOf('if (error || !Array.isArray(data)) return;');
    const write = store.indexOf('set({ user: { ...user, permissions: next } })');
    expect(refusal).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(
      refusal,
      'refreshPermissions now writes before checking the call succeeded — an offline device would lose its grants',
    ).toBeLessThan(write);
  });

  it('runs on launch, so a device that was closed picks up the change', () => {
    const launch = app.indexOf('void useAuthStore.getState().verifySession();');
    const refresh = app.indexOf('void useAuthStore.getState().refreshPermissions();', launch);
    expect(launch).toBeGreaterThan(-1);
    expect(refresh).toBeGreaterThan(launch);
  });

  it('runs again when the app returns to the foreground', () => {
    // A shop phone is left open on the counter: without this, a permission granted mid-shift
    // arrives only after a full relaunch, which is the report this guard exists for.
    const handler = app.indexOf('const onVisible = () =>');
    const listener = app.indexOf('document.addEventListener("visibilitychange", onVisible)', handler);
    expect(handler).toBeGreaterThan(-1);
    expect(listener).toBeGreaterThan(handler);
    const refreshOnFocus = app.indexOf('refreshPermissions()', handler);
    expect(
      refreshOnFocus,
      'the visibility handler no longer refreshes permissions — an open device would keep the sign-in snapshot forever',
    ).toBeGreaterThan(handler);
    expect(refreshOnFocus).toBeLessThan(listener);
  });
});
