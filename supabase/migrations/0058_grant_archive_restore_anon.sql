-- ============================================================
-- Migration 0058: Grant Archive/Restore RPCs to Anon
-- ============================================================

-- Grant archive_customer to anon
GRANT EXECUTE ON FUNCTION archive_customer(uuid, uuid) TO anon;

-- Grant restore_customer to anon
GRANT EXECUTE ON FUNCTION restore_customer(uuid) TO anon;

NOTIFY pgrst, 'reload schema';
