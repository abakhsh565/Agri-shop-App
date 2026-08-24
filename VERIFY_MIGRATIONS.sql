-- =============================================
-- VERIFICATION SCRIPT — Run AFTER all migrations
-- =============================================

-- 1. Check all tables exist
SELECT 'TABLES' as check_type, table_name as name, 
  CASE WHEN rowsecurity THEN 'RLS ✅' ELSE 'RLS ❌' END as status
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY table_name;

-- 2. Check all RPC functions exist
SELECT 'FUNCTIONS' as check_type, routine_name as name, 'EXISTS ✅' as status
FROM information_schema.routines 
WHERE routine_schema = 'public' 
ORDER BY routine_name;

-- 3. Check indexes
SELECT 'INDEXES' as check_type, indexname as name, 'EXISTS ✅' as status
FROM pg_indexes 
WHERE schemaname = 'public' 
ORDER BY indexname;

-- 4. Check helper functions
SELECT 'HELPER FUNCTIONS' as check_type, 
  CASE 
    WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'app_current_user_id') THEN 'app_current_user_id ✅' ELSE 'app_current_user_id ❌'
  END as status
UNION ALL
SELECT 'HELPER FUNCTIONS', 
  CASE 
    WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'app_is_admin') THEN 'app_is_admin ✅' ELSE 'app_is_admin ❌'
  END
UNION ALL
SELECT 'HELPER FUNCTIONS', 
  CASE 
    WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_shop_id') THEN 'current_shop_id ✅' ELSE 'current_shop_id ❌'
  END;

-- 5. Check storage buckets
SELECT 'STORAGE' as check_type, name as name, 'EXISTS ✅' as status
FROM storage.buckets 
ORDER BY name;

-- 6. Check app settings
SELECT 'SETTINGS' as check_type, setting_key as name, setting_value as status
FROM app_settings 
WHERE shop_id = '00000000-0000-0000-0000-000000000001'
ORDER BY setting_key;

-- 7. Check default shop exists
SELECT 'SHOP' as check_type, name as name, 'EXISTS ✅' as status
FROM shops 
WHERE id = '00000000-0000-0000-0000-000000000001';

-- 8. Count objects
SELECT 
  (SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public') as total_tables,
  (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public') as total_functions,
  (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public') as total_indexes;
