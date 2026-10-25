-- ═══════════════════════════════════════════════════════════════════════════════
-- A product belongs to the branches that stock it
--
-- The catalogue table is shop-scoped, so every branch used to render every product:
-- a branch created a minute ago showed the whole catalogue at 0 quantity. That reads
-- as "this branch has these products", which is false — the branch has never held
-- them. This table records where a product actually exists:
--
--   • inserting a product puts it on the creator's branch (or the default branch
--     when there is no branch context, as in seed/test data);
--   • every inventory movement stamps its branch, so receiving stock in another
--     branch is what makes the product appear there;
--   • old rows are backfilled from their movements, and a product with no movement
--     at all stays visible on the default branch, where its legacy stock sits.
--
-- The table is not readable through the API. The app asks `get_branch_product_ids()`
-- for the active branch, so a branch can never enumerate another branch's catalogue.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.product_branches (
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  branch_id  uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, branch_id)
);

CREATE INDEX IF NOT EXISTS product_branches_branch_idx
  ON public.product_branches (branch_id, product_id);

ALTER TABLE public.product_branches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_branches FROM PUBLIC, anon, authenticated;

-- A new product is on the branch that created it. The branch is read from the session,
-- not from the payload, so an older client that does not send one still lands somewhere
-- real. When there is no branch context (seed data, a service call), the default branch
-- of the product's shop is the only honest answer.
CREATE OR REPLACE FUNCTION public.stamp_product_branch_on_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid;
BEGIN
  SELECT b.id INTO v_branch
    FROM public.branches b
   WHERE b.id = public.current_branch_id()
     AND b.tenant_id = NEW.shop_id
     AND b.is_active;

  IF v_branch IS NULL THEN
    SELECT b.id INTO v_branch
      FROM public.branches b
     WHERE b.tenant_id = NEW.shop_id AND b.is_active
     ORDER BY b.is_default DESC, b.created_at, b.id
     LIMIT 1;
  END IF;

  IF v_branch IS NOT NULL THEN
    INSERT INTO public.product_branches (product_id, branch_id)
    VALUES (NEW.id, v_branch)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_product_branch_on_create_trg ON public.products;
CREATE TRIGGER stamp_product_branch_on_create_trg
  AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.stamp_product_branch_on_create();

-- Receiving, selling, adjusting or transferring a product in a branch is what puts it
-- on that branch's shelf. The movement already carries the branch; this records it in
-- the catalogue's own terms, once.
CREATE OR REPLACE FUNCTION public.stamp_product_branch_from_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NOT NULL THEN
    INSERT INTO public.product_branches (product_id, branch_id)
    VALUES (NEW.product_id, NEW.branch_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_product_branch_from_movement_trg ON public.inventory_movements;
CREATE TRIGGER stamp_product_branch_from_movement_trg
  AFTER INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.stamp_product_branch_from_movement();

-- Backfill: every place the ledger says the product has been.
INSERT INTO public.product_branches (product_id, branch_id)
SELECT DISTINCT m.product_id, m.branch_id
  FROM public.inventory_movements m
  JOIN public.products p ON p.id = m.product_id
 WHERE m.branch_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- A product whose movements were only in a branch that has since been deleted has no
-- association left. It still exists in the shop's catalogue, so the default branch is
-- where it is shown — never spread across every branch.
INSERT INTO public.product_branches (product_id, branch_id)
SELECT p.id, b.id
  FROM public.products p
  JOIN LATERAL (
    SELECT b.id
      FROM public.branches b
     WHERE b.tenant_id = p.shop_id AND b.is_active
     ORDER BY b.is_default DESC, b.created_at, b.id
     LIMIT 1
  ) b ON true
 WHERE NOT EXISTS (
   SELECT 1 FROM public.product_branches pb WHERE pb.product_id = p.id
 )
ON CONFLICT DO NOTHING;

-- A product whose only associations are archived branches would otherwise disappear from
-- every active branch. It still exists in the shop, so it is shown on the default active
-- branch rather than nowhere. Archived associations stay for the history.
INSERT INTO public.product_branches (product_id, branch_id)
SELECT p.id, b.id
  FROM public.products p
  JOIN LATERAL (
    SELECT b.id
      FROM public.branches b
     WHERE b.tenant_id = p.shop_id AND b.is_active
     ORDER BY b.is_default DESC, b.created_at, b.id
     LIMIT 1
  ) b ON true
 WHERE NOT EXISTS (
   SELECT 1
     FROM public.product_branches pb
     JOIN public.branches br ON br.id = pb.branch_id
    WHERE pb.product_id = p.id AND br.is_active
 )
ON CONFLICT DO NOTHING;

-- The one read the app gets. It answers for the active branch, and only for products
-- that branch can see. A new branch has no rows here, so its catalogue is empty.
CREATE OR REPLACE FUNCTION public.get_branch_product_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_branch AS (
    SELECT COALESCE(
      (SELECT b.id
         FROM public.branches b
        WHERE b.id = public.current_branch_id()
          AND b.tenant_id = public.current_shop_id()
          AND b.is_active),
      (SELECT b.id
         FROM public.branches b
        WHERE b.tenant_id = public.current_shop_id() AND b.is_active
        ORDER BY b.is_default DESC, b.created_at, b.id
        LIMIT 1)
    ) AS id
  )
  SELECT pb.product_id
    FROM public.product_branches pb
    JOIN public.products p ON p.id = pb.product_id
   WHERE p.shop_id = public.current_shop_id()
     AND p.is_active
     AND pb.branch_id = (SELECT id FROM active_branch)
   ORDER BY pb.product_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_branch_product_ids() TO authenticated;
REVOKE ALL ON FUNCTION public.get_branch_product_ids() FROM PUBLIC, anon;
