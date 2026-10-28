import { beforeEach, describe, expect, it } from "vitest";
import {
  clearNav,
  navDepth,
  popNav,
  recordNav,
} from "../../src/lib/navContext";

/**
 * The back button walks this stack, so these are the rules a reader feels.
 *
 * The failing case the suite exists for: a form that saves itself and `replace`s its own entry
 * with the saved record. Recorded as a push, back from the record re-opened the completed form.
 * Recorded as a replace, the record inherits the form's place and back lands on the screen
 * before the form — which is where the reader came from.
 */
beforeEach(() => clearNav());

describe("the journey stack", () => {
  it("walks back the way the reader came, one step at a time", () => {
    recordNav("/admin/settings", "/admin/dashboard", "push");
    recordNav("/admin/settings/hub/finance", "/admin/settings", "push");
    recordNav("/admin/payments/cash-position", "/admin/settings/hub/finance", "push");

    expect(popNav("/admin/payments/cash-position")).toBe("/admin/settings/hub/finance");
    expect(popNav("/admin/settings/hub/finance")).toBe("/admin/settings");
  });

  it("lets the saved record inherit the form's place, never the form itself", () => {
    recordNav("/admin/settings/hub/purchases", "/admin/settings", "push");
    recordNav("/admin/purchases/new", "/admin/settings/hub/purchases", "push");
    // The form saved and replaced its own entry with the record.
    recordNav("/admin/purchases/42", "/admin/purchases/new", "replace");

    // Back goes to the hub the form was opened from — never to the form itself.
    expect(popNav("/admin/purchases/42")).toBe("/admin/settings/hub/purchases");
  });

  it("drops the frame it leaves when a step is undone", () => {
    recordNav("/admin/settings", "/admin/dashboard", "push");
    recordNav("/admin/settings/hub/finance", "/admin/settings", "push");
    expect(navDepth()).toBe(2);

    recordNav("/admin/settings", "/admin/settings/hub/finance", "back");
    expect(navDepth()).toBe(1);
    expect(popNav("/admin/settings/hub/finance")).toBeNull();
  });

  it("keeps the reader's own path, not the screen's assumed parent", () => {
    // The supplier ledger, reached from Finance rather than from the overview it is coded to
    // fall back to.
    recordNav("/admin/settings/hub/finance", "/admin/settings", "push");
    recordNav("/admin/settings/overview/suppliers", "/admin/settings/hub/finance", "push");
    expect(popNav("/admin/settings/overview/suppliers")).toBe("/admin/settings/hub/finance");
  });

  it("starts empty after a dashboard, so back never leaves the app there", () => {
    recordNav("/admin/customers", "/admin/settings", "push");
    clearNav();
    expect(navDepth()).toBe(0);
    expect(popNav("/admin/customers")).toBeNull();
  });
});
