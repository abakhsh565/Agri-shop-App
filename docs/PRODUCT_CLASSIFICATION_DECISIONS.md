# Product classification — decisions

## D1. Classification belongs to the category, not to a shared template

**Decision:** store one optional profile per category and resolve upward to the nearest
configured ancestor.

**Reason:** the category is already the stable grouping for products, and a profile on a parent
can serve every child without duplicating data.

**Trade-off:** changing a parent changes the defaults for descendants that have not overridden
them. That is the intended meaning of inheritance and is visible as "Inherited from …" on the
child's screen.

**Rejected:** global templates assigned to categories. They add a second object to manage and
still need a category-to-template mapping.

## D2. The profile stores forms, and each form owns its unit groups

**Decision:** `physical_forms` is a JSON array of `{ code, unitGroups }`; profiles also store a
preset and handling types.

**Reason:** unit compatibility depends on the form (liquid → volume, powder → weight), not on the
category alone. This keeps the rule explicit and lets a child override one form without
redefining the category.

**Trade-off:** a malformed JSON payload can express an empty form. The category form blocks empty
forms and empty groups, and the product RPC validates a submitted form against the resolved
profile.

## D3. Presets are starting points only

**Decision:** Crop Protection, Fertilizers, Seeds, Equipment, Irrigation, Plant Nutrition and
General seed the editor; the saved profile is authoritative.

**Reason:** presets remove repetitive setup while still allowing a shop to describe its own
shelf. Existing categories are mapped once by their legacy kind.

**Rejected:** locking a category to a preset. That would make the preset the business rule rather
than a convenience.

## D4. Preserve the existing RPCs behind classification-aware wrappers

**Decision:** add `save_product_category_with_classification`,
`create_product_with_classification` and `update_product_with_classification`; they call the
existing RPCs first, then validate and store classification.

**Reason:** existing callers, permissions and business rules stay intact. Rollback keeps the
category/product and its classification changes atomic.

**Rejected:** rewriting the existing category/product RPCs. That would couple unrelated catalogue
logic and increase regression risk.

## D5. The first form is the default; the unit is never a second question

**Decision:** a new product opens on the category's first physical form, and its unit is chosen
automatically from that form. The form choice itself names the unit, e.g. “Liquid · Liter”. The
separate Unit field is gone.

**Reason:** the form already determines the measurement family. Asking for both made the owner
answer the same question twice and allowed contradictory answers.

**Trade-off:** a category with several forms does not force a blank choice. The owner can change
the initial form if the product is not the first form; an untouched legacy edit keeps its null
form so an unrelated save cannot reclassify it.

## D6. Units are derived from forms, never invented

**Decision:** Add Product derives the product unit from the selected form's unit family using
the shop's existing units. If the shop has no compatible unit, the form shows a blocking note;
the backend also refuses a mismatched unit.

**Reason:** units remain the shop's data. Classification cannot create a unit or assume that a
kilogram exists.

## D7. Pack-size units follow the product's family

**Decision:** switching the product unit moves each pack's display unit into the same family,
keeping the typed number.

**Reason:** the pack number is meaningless without the right unit, and there is no honest
conversion between weight, volume and count.

**Trade-off:** the number is not converted. That is deliberate: silently changing 28 kg to 28 L
would be worse than asking the owner to correct a number after the unit changes.

## D8. Legacy products keep their legacy shape

**Decision:** an existing product with no physical form is not forced into one on an unrelated
edit. Its stored form (when present) is also retained if its category profile later disappears.
A form is validated when the owner actually changes the classification. The unit picker is gone
for every product; an untouched legacy edit keeps its stored unit.

**Reason:** existing products and workflows must remain usable. Historical data may predate the
profile, and a category edit must not make an old product unsaveable.

**Trade-off:** legacy products can remain unclassified until someone edits their classification
deliberately. This is safer than guessing.

## D9. Keep the existing product screen and design system

**Decision:** add one form-derived field to the current Add Product page; put only the form
choices on the existing category form. Reuse `InlineSelect`, `SelectorField`, pill buttons, the
type ramp, spacing and colour tokens. No separate page or multi-step flow.

**Reason:** the owner explicitly required the current Add Product experience to stay. The new
field is only useful in the context of the product being created.

**Simplification (2026-11-03):** Categories no longer shows zero subcategory/item counts or
initials tiles, and its editor no longer asks for a preset, compatible unit groups or handling
types. The unit family is derived from each selected form; preset and handling data on an
existing profile are preserved. Catalogue is reduced to the two jobs Add Product actually uses:
Categories and Units. “All products” was removed because it repeated the Products list, and the
Products list now carries a direct Manage catalogue action.

**Accessibility/RTL:** labels, logical spacing, 44px class touch targets where the existing
system uses them, `aria-pressed` on form/group/handling chips, and EN/UR copy. The screen inherits
the existing RTL shell.

## D10. Defer Length

**Decision:** support Weight, Volume and Count only.

**Reason:** existing pack-size conversion only supports kg, liter and piece. Adding Length would
require a broader conversion change and is outside this request.

**Follow-up:** add the group and its conversion rules together, not the chip alone.
