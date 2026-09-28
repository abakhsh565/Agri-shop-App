-- 0162 — pesticide and spray are one category.
--
-- The enum has held both values since the schema was written, and the app has offered the
-- two as if they were different kinds of thing. They are not: the same bottle is bought for
-- the same job at the same time of year, and the only thing the split ever produced was a
-- product that could not be found under the filter its owner picked. The Add Product form
-- offers "Pesticide" alone, so from now on new rows can only be that one; this migration
-- folds the rows that were filed under the other name into it.
--
-- The enum value itself is deliberately left in place. Dropping an enum value rewrites the
-- type and fails on any row still using it, and a stored `spray` that no screen can produce
-- any more is a smaller problem than a migration that cannot be replayed. Nothing about a
-- product's history is touched: `category` is not part of any sale, movement or return.
--
-- Idempotent: re-running finds nothing to change.

UPDATE products
   SET category = 'pesticide'
 WHERE category = 'spray';
