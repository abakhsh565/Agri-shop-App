-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0097: Fix ALL table grants for authenticated role
-- ═══════════════════════════════════════════════════════════════════════════════
-- ROOT CAUSE: Most public business tables were created without GRANTs for
-- the authenticated role. RLS policies existed but PostgreSQL requires BOTH:
--   1. Table-level GRANT (role permission to use the table)
--   2. RLS policy (row-level authorization)
-- Without the GRANT, even valid RLS policies are unreachable.
--
-- SAFETY: Additive only. Does not drop any existing grants or policies.
-- RLS policies remain the authorization layer; these GRANTs only enable access.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Business tables that the frontend or RPCs access:
DO $$
DECLARE
  tbl text;
  business_tables text[] := ARRAY[
    'customers',
    'companies',
    'products',
    'product_variants',
    'sales',
    'sale_items',
    'purchases',
    'purchase_items',
    'payments',
    'customer_payments',
    'supplier_payments',
    'inventory_movements',
    'stock_adjustments',
    'returns',
    'return_items',
    'voids',
    'notifications',
    'business_settings',
    'app_settings',
    'shops',
    'users',
    'customer_crops',
    'reminder_configs',
    'reminder_occurrences',
    'reminder_logs',
    'reminder_configs',
    'credit_limit_requests',
    'cash_reconciliations',
    'daily_cash_reconciliations',
    'memberships',
    'branches',
    'shop_requests'
  ];
BEGIN
  FOREACH tbl IN ARRAY business_tables LOOP
    -- Grant full CRUD (SELECT, INSERT, UPDATE, DELETE)
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', tbl);
  END LOOP;
END $$;

-- System/engineering tables (selective — frontend may need read access):
DO $$
DECLARE
  tbl text;
  system_tables text[] := ARRAY[
    'activity_log',
    'audit_events',
    'incident_rate_limits',
    'incident_signatures',
    'incidents'
  ];
BEGIN
  FOREACH tbl IN ARRAY system_tables LOOP
    EXECUTE format('GRANT SELECT ON %I TO authenticated', tbl);
  END LOOP;
END $$;

-- Ensure future tables also get grants automatically:
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
