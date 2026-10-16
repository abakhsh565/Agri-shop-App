/**
 * The sign-in door rule must exist, and it must run before a code is spent.
 *
 * WHY A GUARD AND NOT JUST THE CODE. The rule has two halves and only one of them is visible when
 * it breaks. The half people notice is the message ("this number belongs to a shop owner"). The
 * half that matters is WHERE the check sits: an owner pushed through the employee's questions, or
 * an employee signing in without ever naming their shop, is a wrong-door sign-in that looks like a
 * successful one. Moving the check one line down — after `sendOTP` — would leave every visible
 * symptom identical and quietly allow a code to be spent on a sign-in that should have been
 * refused, so the position is asserted rather than trusted.
 *
 * The rule reads `lookup_user_by_phone`'s role (owner ⇒ "owner" tab, anything else ⇒ "employee"
 * tab). That the RPC still reports a role at all is proved against the database in
 * tests/integration/signInDoor.test.ts; this file guards the screen that consumes it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const LOGIN_PAGE = path.resolve(process.cwd(), 'src/pages/auth/LoginPage.tsx');
const source = fs.readFileSync(LOGIN_PAGE, 'utf-8');

describe('Sign-in door', () => {
  it('refuses the number at the other door, in both directions', () => {
    // The two message keys are the refusal. A rule that only refused one direction would let
    // exactly half the reported bug back in.
    expect(source).toContain('auth.wrongDoorOwner');
    expect(source).toContain('auth.wrongDoorEmployee');
  });

  it('decides the door from the server\'s role, not from the tab that was tapped', () => {
    // `check.role` is `lookup_user_by_phone`'s answer about the account. A rule written against
    // `role` (the tab's own state) would compare a value with itself and always pass.
    expect(source).toMatch(/check\.role\s*===\s*"admin"\s*\?\s*"owner"\s*:\s*"employee"/);
  });

  it('checks the door BEFORE spending a verification code', () => {
    const door = source.indexOf('auth.wrongDoorOwner');
    const send = source.indexOf('sendOTP(');
    expect(door).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(-1);
    expect(
      door,
      'the door check moved below sendOTP — a wrong-door sign-in would now spend a code before being refused'
    ).toBeLessThan(send);
  });

  it('keeps the door check inside the registered-account branch', () => {
    // An unregistered number must not be told which door it belongs at: it is routed to
    // registration instead, and the door check must not run for it.
    const registered = source.indexOf('check.status !== "registered"');
    const door = source.indexOf('auth.wrongDoorOwner');
    expect(registered).toBeGreaterThan(-1);
    expect(registered).toBeLessThan(door);
  });
});
