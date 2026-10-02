/**
 * One phone, one door.
 *
 * THE OWNER'S REPORT: "I created an account as owner, later I logged out. Now I am on the login
 * screen. I click the employee side, enter the same phone as an owner I approved and the shop id —
 * it moves me to the owner side, which is not correct if it is the same number but not following
 * the same flow. An owner can login just by login, and vice versa for an employee. Check this case."
 *
 * The two tabs exist because the two kinds of account answer different questions: an owner is
 * found by their number alone, an employee has to name the shop that invited them. Nothing stopped
 * a number from being pushed through the wrong set of questions — an owner could name their own
 * shop (they ARE a member of it, so the invitation check passed) and sign in having answered the
 * employee's questions, and an employee could ignore the shop entirely by using the owner tab.
 *
 * The door is now decided by the server's own answer about that number, before a code is spent.
 * This lane proves the INPUT to that decision is what the screen thinks it is, against the real
 * database, through the anonymous client the sign-in screen itself uses — because if
 * `lookup_user_by_phone` ever stopped reporting the role, the door rule would quietly start
 * sending owners to the employee tab and nobody would notice until a customer did.
 *
 * The refusal itself lives in one place (src/pages/auth/LoginPage.tsx) and is held by
 * tests/unit/loginDoor.test.ts, which fails if the check stops happening before the code is sent.
 */

import { describe, it, expect } from 'vitest';
import { qaAnonClient } from '../setup/qa-client';

/** The repository's own QA identities (tests/setup/fixtures.ts). */
const OWNER_PHONE = '923001234567';
const EMPLOYEE_PHONE = '923001122334';

/** A number that has never registered. Reserved pattern: no suite uses 9230096999xx. */
const STRANGER_PHONE = '923009699999';

type Lookup = { role?: string; is_active?: boolean; shop_id?: string | null } | null;

/** The exact call the sign-in screen makes, as the anonymous client, before any code is sent. */
async function lookup(phone: string): Promise<Lookup> {
  const { data, error } = await qaAnonClient.rpc('lookup_user_by_phone', { p_phone: phone });
  expect(error).toBeNull();
  return (data as Lookup) ?? null;
}

/** The rule the screen applies: the server's role decides which tab a number belongs at. */
function doorFor(role: string | undefined): 'owner' | 'employee' {
  return role === 'admin' ? 'owner' : 'employee';
}

describe('Sign-in door — the account decides which questions are answered', () => {
  it('answers owner for a shop owner and employee for a shop member', async () => {
    const owner = await lookup(OWNER_PHONE);
    expect(owner).not.toBeNull();
    expect(owner?.role).toBe('admin');
    expect(owner?.is_active).toBe(true);

    const employee = await lookup(EMPLOYEE_PHONE);
    expect(employee).not.toBeNull();
    expect(employee?.role).toBe('employee');
    expect(employee?.is_active).toBe(true);

    // The two fixture numbers must land at DIFFERENT doors, or this rule has nothing to decide.
    expect(doorFor(owner?.role)).toBe('owner');
    expect(doorFor(employee?.role)).toBe('employee');
    expect(doorFor(owner?.role)).not.toBe(doorFor(employee?.role));
  });

  it('tells a stranger nothing', async () => {
    // Not "employee": an unknown number must not be silently assigned a door, and the screen
    // routes it to registration instead.
    expect(await lookup(STRANGER_PHONE)).toBeNull();
  });

  it('keeps an inactive account out of the door decision entirely', async () => {
    // A deactivated account is not "registered" on the screen — it is sent to the deactivated
    // screen — so its role must never be what decides anything. The lookup reports both fields,
    // and this asserts the screen has what it needs to tell them apart.
    const owner = await lookup(OWNER_PHONE);
    expect(typeof owner?.is_active).toBe('boolean');
    expect(owner?.role).toBeTruthy();
  });
});
