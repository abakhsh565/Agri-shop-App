-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0144: publish the tables the app already subscribes to
-- ═══════════════════════════════════════════════════════════════════════════════
-- FOUND: `supabase_realtime` contained NO tables.
--
--   SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';
--   -> (none)
--
-- Postgres only emits logical-replication changes for tables that are part of a
-- publication, so every Realtime subscription in the app was silently dead. The
-- stores subscribe on mount (`useBootstrapData`: "wires Realtime so any device sees
-- new sales/stock/customers immediately") and their callbacks refresh the data, but
-- no event ever arrived:
--
--   product_variants  → stock on screen did not follow a purchase or a sale
--   products          → a new product did not appear
--   customers         → a new customer / credit change did not appear
--   sales             → a sale recorded on another device did not appear
--   companies         → supplier payable did not follow a purchase or a payment
--   notifications     → in-app notifications did not arrive until a reload
--   users             → a display name / membership change waited for a reload
--
-- This adds exactly those tables and nothing else. Realtime honours RLS, so a
-- subscriber still only receives rows they are allowed to read.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'products', 'product_variants', 'customers', 'sales',
    'companies', 'notifications', 'users'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END $$;

-- Realtime applies RLS per subscriber. These tables were all created before the
-- publication existed, so confirm the policy set the subscriptions depend on is
-- present rather than assuming it (a table with RLS on and no SELECT policy
-- delivers nothing to anyone).
DO $$
DECLARE
  v_gap text;
BEGIN
  SELECT string_agg(t.tablename, ', ')
    INTO v_gap
    FROM pg_publication_tables p
    JOIN pg_class c ON c.relname = p.tablename
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = p.schemaname
    JOIN pg_tables t ON t.tablename = p.tablename AND t.schemaname = p.schemaname
   WHERE p.pubname = 'supabase_realtime'
     AND c.relrowsecurity = true
     AND NOT EXISTS (SELECT 1 FROM pg_policies pol WHERE pol.schemaname = p.schemaname AND pol.tablename = p.tablename);

  IF v_gap IS NOT NULL THEN
    RAISE WARNING 'realtime published but no RLS policy (subscribers receive nothing): %', v_gap;
  END IF;
END $$;
