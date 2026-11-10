-- 0305: add the product_category labels production is missing
--
-- Root cause (proven 2026-11-10, batch 1 apply run 42755609508): production's
-- public.product_category enum holds only 'spray', 'seed', 'fertilizer',
-- 'other' (pg_dump capture 2026-11-10T01-28-00Z), while 0259's
-- seed_product_taxonomy INSERTs seven categories casting
-- v.kind::product_category — 'pesticide', 'herbicide' and 'equipment' are
-- labels production lacks, so real Postgres rejects the INSERT at rehearsal
-- and batch 1 (0233-0276) cannot apply. 0259 is already recorded on QA, so
-- it must not be edited; the labels arrive here instead.
-- ADD VALUE IF NOT EXISTS is idempotent: on QA, where the labels already
-- exist, this is a no-op. Must apply BEFORE batch 1 (0233-0276), as its own
-- apply: a label added by ALTER TYPE cannot be used until its transaction
-- commits, so it cannot ride inside 0259 or the batch-1 transaction.

ALTER TYPE public.product_category ADD VALUE IF NOT EXISTS 'pesticide';
ALTER TYPE public.product_category ADD VALUE IF NOT EXISTS 'herbicide';
ALTER TYPE public.product_category ADD VALUE IF NOT EXISTS 'equipment';

-- Self-check: every label 0259 seeds must now exist in the enum.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(label, ', ' ORDER BY label) INTO missing
    FROM (VALUES ('pesticide'), ('herbicide'), ('equipment')) AS v(label)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'product_category' AND e.enumlabel = v.label
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '0305: product_category still missing %', missing;
  END IF;
END $$;
