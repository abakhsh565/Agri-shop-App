import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const url = 'https://bpybjrjenwccowvtrevu.supabase.co';
const key = readFileSync('.env.qa', 'utf-8')
  .split('\n')
  .find(l => l.startsWith('QA_SUPABASE_SERVICE_ROLE='))
  ?.split('=')[1]?.trim() || '';

const supabase = createClient(url, key);

const APP_RPC_NAMES = [
  'create_customer', 'create_company', 'create_product', 'create_sale',
  'create_purchase', 'adjust_stock', 'void_sale', 'void_sale_v1',
  'record_customer_payment', 'record_supplier_payment', 'process_return',
  'archive_customer', 'restore_customer', 'delete_product',
  'lookup_user_by_phone', 'approve_shop_request', 'insert_shop_request',
  'record_cash_reconciliation_v1', 'deactivate_employee_v1',
  'update_product', 'create_credit_limit_request',
  'approve_credit_limit_request', 'reject_credit_limit_request',
  'lookup_product_by_barcode', 'check_rate_limit', 'record_attempt',
  'record_incident', 'resolve_shop_and_actor', 'resolve_tenant_for_user',
  'current_shop_id', 'get_current_tenant_id', 'get_current_membership',
  'is_authorized_for_tenant', 'app_current_user_id', 'app_is_admin',
];

async function main() {
  // Get definitions for app RPCs
  const names = APP_RPC_NAMES.map(n => `'${n}'`).join(',');
  const { data } = await supabase.rpc('run_sql', {
    sql_query: `SELECT proname, pg_get_functiondef(oid) as def FROM pg_proc WHERE proname IN (${names}) ORDER BY proname`
  });
  
  const funcs = JSON.parse(data);
  
  console.log('=== RPC AUDIT ===\n');
  
  for (const f of funcs) {
    const d = f.def || '';
    let resolution = 'N/A';
    if (d.includes('resolve_shop_and_actor')) resolution = '✅ RESOLVE_SHOP_ACTOR';
    else if (d.includes('resolve_tenant_for_user')) resolution = '✅ RESOLVE_TENANT (fallback)';
    else if (d.includes('current_shop_id()')) resolution = '⚠️  current_shop_id (no fallback)';
    else if (/00000000-0000-0000-0000-000000000001/.test(d)) resolution = '❌ HARDCODED SHOP_ID';
    else if (!d.includes('shop_id')) resolution = 'ℹ️  no shop_id';
    
    // Check if function is SECURITY DEFINER
    const isSecDef = d.includes('SECURITY DEFINER');
    // Check if function accepts payload jsonb
    const hasPayload = d.includes('payload jsonb');
    // Check if function has GRANT to authenticated
    const hasGrant = d.includes('TO authenticated');
    
    console.log(`${f.proname}: ${resolution} ${isSecDef ? '(SECDEF)' : ''} ${hasPayload ? '(payload)' : ''}`);
  }
  
  // Check frontend stores that do direct inserts
  console.log('\n=== FRONTEND DIRECT INSERT AUDIT ===\n');
  
  // Get all tables the frontend writes to directly (via PostgREST)
  const { data: frontendTables } = await supabase.rpc('run_sql', {
    sql_query: `SELECT policyname, tablename, cmd, with_check FROM pg_policies WHERE cmd = 'INSERT' AND roles = 'authenticated' ORDER BY tablename`
  });
  
  const policies = JSON.parse(frontendTables);
  for (const p of policies) {
    const hasShopCheck = p.with_check?.includes('current_shop_id') || false;
    const hasAdminCheck = p.with_check?.includes('app_is_admin') || false;
    console.log(`${p.tablename}: RLS INSERT ${hasShopCheck ? 'shop_check' : ''} ${hasAdminCheck ? 'admin_check' : ''} — ${p.with_check || 'true'}`);
  }
}

main().catch(console.error);
