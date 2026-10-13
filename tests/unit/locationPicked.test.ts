/**
 * A location is picked on a map, never typed — and only ever written by one guarded writer.
 *
 * WHY A GUARD. The requirement is a negative: "the user cannot manually enter the location". A
 * negative cannot be tested by looking at the screen that was just built — it is broken the moment
 * somebody adds a fifth screen, or a helpful "address" box next to the pin, and no test of the
 * picker would notice. So two things are asserted over the whole source tree:
 *
 *   1. every screen that stores a place offers the PICKER, and
 *   2. nothing writes `latitude`/`longitude` through a query builder — the only writer is
 *      `set_place()` (and the two RPC payloads that carry a place with a new row), which is the
 *      half that enforces "inside Pakistan" and "a row of yours" (0172).
 *
 * The map service's own answer is checked twice in `lib/geo.ts` (the request asks for
 * `countrycodes=pk`, and every returned row is re-checked against its own `country_code`); this
 * file is about the app not growing a third way in.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/** Every .ts/.tsx under src, excluding the module that defines what a place is. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && entry.name !== "geo.ts") out.push(full);
  }
  return out;
}

const SRC = path.resolve(process.cwd(), "src");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf-8");

describe("Locations are picked, not typed", () => {
  it("gives every screen that stores a place the map picker", () => {
    // Adding a customer, registering a shop, editing a branch, creating a branch — the four
    // places the requirement names, each of which used to have a free-text address field.
    //
    // `via` is where a screen reaches the picker through a component that owns the form rather
    // than importing the field itself: the branch screen renders `BranchEditor`, and the field
    // moved into it when the branch form stopped being a sheet of its own. The rule being
    // enforced is "a place is picked on a map somewhere on the way to the screen", not "this
    // particular file spells the import" — so the delegation is followed rather than the entry
    // deleted, which would leave editing a branch unguarded.
    const screens = [
      { file: "pages/employee/customers/AddCustomerPage.tsx", via: [] as string[] },
      { file: "pages/register/RegisterShopDetailsPage.tsx", via: [] },
      { file: "pages/admin/more/BranchDetailPage.tsx", via: ["components/shop/BranchEditor.tsx"] },
      { file: "components/shop/ShopSwitcherSheet.tsx", via: [] },
    ];
    const missing = screens
      .filter(({ file, via }) => ![file, ...via].some((f) => read(f).includes("LocationField")))
      .map(({ file }) => file);
    expect(missing, "these screens store a place but offer no map to pick it on").toEqual([]);
  });

  it("no longer offers a typed address on those screens", () => {
    // The old free-text field, by its own state/handler names. A location screen may have other
    // text inputs (a name, a city); what it may not have is one that feeds the stored address.
    const typedAddress = [
      { file: "pages/employee/customers/AddCustomerPage.tsx", marker: "setAddress(" },
      { file: "pages/register/RegisterShopDetailsPage.tsx", marker: "setShopAddress(" },
    ];
    const offenders = typedAddress.filter(({ file, marker }) => read(file).includes(marker));
    expect(
      offenders.map((o) => `${o.file} → ${o.marker}`),
      "a location field was typed into again — the stored point and the typed words can then disagree",
    ).toEqual([]);
  });

  it("writes a location only through the guarded writer", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const source = fs.readFileSync(file, "utf-8");
      for (const match of source.matchAll(/(latitude|longitude)/g)) {
        // The statement this mention sits in, as far as a query builder chain would extend.
        const start = Math.max(0, (match.index ?? 0) - 400);
        const window = source.slice(start, (match.index ?? 0) + 400);
        const writesThroughBuilder =
          /\.from\(/.test(window) && /\.(update|insert|upsert)\(/.test(window) && !/\.rpc\(/.test(window);
        if (writesThroughBuilder) {
          offenders.push(`${path.relative(process.cwd(), file).replace(/\\/g, "/")} — ${match[0]}`);
        }
      }
    }
    expect(
      [...new Set(offenders)],
      "a location is being written straight to a table, bypassing the Pakistan box and the ownership check",
    ).toEqual([]);
  });

  it("reads a branch's pin from the branch list, not from `shops`", () => {
    // `shops` has exactly one SELECT policy — `id = current_shop_id()` — so a query for any other
    // branch answers with an EMPTY ARRAY rather than an error. A screen that asked it anyway would
    // report "no location" about a branch that has one, which is precisely what the branch-edit
    // picker did until the place was carried on `get_my_branches()`. The rule is therefore: no
    // client code reads `shops` at all. Narrowing a read to the current branch is what
    // `get_my_shops()`/`get_my_branches()` are for.
    const offenders = sourceFiles(SRC).filter((file) =>
      /\.from\(\s*["']shops["']\s*\)/.test(fs.readFileSync(file, "utf-8")),
    );
    expect(
      offenders.map((f) => path.relative(process.cwd(), f).replace(/\\/g, "/")),
      "a screen is reading `shops` directly; only the branch being worked in is visible there, so every other branch reads as 'nothing'",
    ).toEqual([]);

    // And the place really does come from the branch read, in the shape the picker speaks.
    const store = read("stores/shopStore.ts");
    expect(store).toContain("location_label");
    expect(store).toContain("branchPlaceFrom");
  });

  it("the picker stores only what the map service returned", () => {
    const picker = read("components/ui/LocationField.tsx");
    // One text box, and it is the SEARCH — a question, not the value. A second one bound to the
    // place is how a typed coordinate gets in.
    expect(picker.match(/<input/g)?.length ?? 0).toBe(1);
    expect(picker).not.toMatch(/<input[^>]*value=\{value/);
    // The place is set from a selected row or from a reverse-geocoded point, both of which carry
    // the service's own country code; never from an onChange of a field.
    expect(picker).toContain("reverseInPakistan");
    expect(picker).toContain("provider.search");
  });
});
