# Product classification — context

Feature: category-owned product classification, with nearest-ancestor inheritance and
form-compatible units.

## Product and business

- **Verified:** AgriShop manages shop catalogues, stock, purchases and sales. Products already
  belong to the shop's own categories and units (migration 0259).
- **Verified:** the product form is one existing screen used for both create and edit. Category
  and unit creation already have their own screens.
- **Inferred:** owners add products often, often from a phone, so classification must not add a
  second workflow or a separate management screen.
- **Verified:** the request keeps Weight, Volume and Count as the supported unit groups. Length
  is deferred because pack sizes and conversions only support kg, liter and piece today.

## Users and tasks

- **Verified:** an owner creates and edits products; an employee with `products.create` or
  `products.edit` uses the same form from the employee shell.
- **Inferred:** the owner knows the product form and unit, but should not have to remember which
  units belong to which form.
- **Inferred:** a category is the durable place for that knowledge because it applies to every
  product on the shelf and to its children.

## Screen behaviour

- **Verified:** a category may define several physical forms. Each form carries one or more unit
  groups.
- **Verified:** a missing category profile means inherit the nearest configured ancestor.
- **Verified:** the first form is selected automatically and the unit is derived from it, so the
  owner never answers a separate unit question. The form control names the unit it will use.
- **Verified:** changing the form moves the product unit and pack-size units to the same family.
- **Verified:** legacy products may have no physical form. An untouched edit must remain saveable
  even after its category profile changes.
- **Verified (2026-11-03):** the Catalogue menu was reduced to its two Add Product dependencies,
  Categories and Units. The duplicate All products door was removed. Categories lists only real
  product counts and the forms each shelf supports; its editor keeps only the form choices.

## System and constraints

- **Verified:** React + Vite client; Supabase/Postgres backend; existing category and product RPCs
  are authoritative.
- **Verified:** category/product writes already use RPCs rather than direct table writes. Existing
  clients must keep working.
- **Verified:** existing design primitives are `InlineSelect`, `SelectorField`, pill buttons,
  `NavHeader`, `ConfirmDialog`, type-ramp classes and existing colour tokens.
- **Verified:** English and Urdu/RTL are both required; the microcopy, i18n coverage and parity
  guards enforce this.

## Unknowns

- **Unknown:** no usage analytics or owner interviews were available for this feature. The
  workflow is inferred from the existing screen and the owner's stated requirements.
- **Unknown:** whether shops will later need Length or custom unit groups. The schema stores
  group codes, so adding a group is an extension rather than a redesign.

## Preserved behaviour

- One Add Product page, same layout and footer.
- Existing categories, units, products and conversion logic.
- Existing product/category RPC entry points.
- English + Urdu and both text directions.
