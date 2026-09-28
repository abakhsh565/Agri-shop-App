-- MIGRATION 0159: an unknown cost is not a zero cost (profit correctness)
--
-- Profit is revenue minus cost of goods. 0127 made the COGS snapshot honest about WHEN it
-- was written (NULL = not recorded, 0 = recorded and genuinely free) and stamped it from
-- the variant's own cost at sale time, so a product deactivated later could not rewrite
-- the profit of a sale already made.
--
-- One hole was left in that fix. A variant whose cost_price was never filled in holds 0,
-- so the trigger stamped `0 * qty = 0` — which the schema reads as "this item was
-- genuinely free", turning its entire sale price into profit. The QA shop showed exactly
-- that: Total Sales 7,200 with Gross Profit 7,200, a 100% margin, because both products on
-- that sale had cost_price = 0. Every screen was then accused of bad arithmetic while the
-- arithmetic was right and the INPUT was a lie.
--
-- The two readings of a 0 cost are not equally safe. Reading a cost nobody entered as
-- "free" can only ever overstate profit, and overstating profit is the direction that
-- costs the owner money; reading it as unknown just declines to claim a figure. So the
-- trigger now stamps only a cost that is actually known (greater than zero) and leaves the
-- line NULL otherwise, which is the value the app already treats as "not recorded".
--
-- Nothing about revenue, quantities, receipts or history changes here: this only stops the
-- database from asserting a cost the shop never entered.

CREATE OR REPLACE FUNCTION public.stamp_line_cogs()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Only when nothing was recorded, only when the line has a variant to price it from,
  -- and only when that variant's cost is a real cost. A variant with no cost set must
  -- leave the line NULL ("not recorded"), never 0 ("free"): 0 would claim the shop paid
  -- nothing for the item and turn its whole sale price into profit.
  IF NEW.cogs_amount IS NULL AND NEW.variant_id IS NOT NULL AND NEW.qty IS NOT NULL THEN
    SELECT v.cost_price * NEW.qty
      INTO NEW.cogs_amount
      FROM product_variants v
     WHERE v.id = NEW.variant_id AND v.cost_price > 0;
  END IF;
  RETURN NEW;
END;
$function$;

-- Lines already stamped 0 from a variant that still has no cost are that same unknown read
-- as free. Rewriting them to NULL changes no total that was ever right, and corrects the
-- ones that were overstated. A line stamped 0 from a variant that DOES have a cost today is
-- left alone: it is a real snapshot of a real price, and re-pricing history is the bug 0127
-- existed to prevent.
UPDATE sale_items si
   SET cogs_amount = NULL
 WHERE si.cogs_amount = 0
   AND NOT EXISTS (
     SELECT 1
       FROM product_variants v
      WHERE v.id = si.variant_id
        AND v.cost_price > 0
   );
