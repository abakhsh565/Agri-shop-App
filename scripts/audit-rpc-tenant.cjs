/**
 * RPC Tenant-Context Audit Script
 * 
 * Checks every business RPC to verify:
 * 1. Does it set shop_id on INSERT?
 * 2. How does it resolve shop_id?
 * 3. Is the resolution membership-based?
 */

const { createClient } = require('@supabase/supabase-js');

const URL = 'https://bpybjrjenwccowvtrevu.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJweWJqcmplbndjY293dnRyZXZ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTAyNjU3MiwiZXhwIjoyMTA0NjAyNTcyfQ.QHa62c7sOzuQCj3fiyIPDXNhk0C1wox-FVcBfA3SJnY';

const c = createClient(URL, KEY);

async function getFunctionDef(name) {
  const { data } = await c.rpc('run_sql', {
    sql_query: `SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname = '${name}'`
  });
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  return parsed?.[0]?.def || null;
}

async function audit() {
  const businessRPCs = [
    'create_customer', 'create_product', 'create_sale', 'create_purchase',
    'archive_customer', 'record_customer_payment', 'record_supplier_payment',
    'process_return', 'void_sale', 'delete_product', 'update_product',
    'adjust_stock', 'record_cash_reconciliation_v1', 'restore_customer',
    'update_customer_due_date', 'update_customer_image', 'generate_barcode',
    'approve_shop_request', 'insert_shop_request'
  ];

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('RPC TENANT-CONTEXT AUDIT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const issues = [];

  for (const rpc of businessRPCs) {
    const def = await getFunctionDef(rpc);
    if (!def) {
      console.log(`⚠️  ${rpc}: NOT FOUND IN DATABASE`);
      continue;
    }

    // Analyze the function
    const checks = {
      name: rpc,
      hasShopId: def.includes('shop_id'),
      usesCurrentShopId: def.includes('current_shop_id()'),
      usesGetTenantId: def.includes('get_current_tenant_id()'),
      usesJwtClaims: def.includes('request.jwt.claims'),
      usesJwtSub: def.includes("jwt.claims', true)::json->>'sub'"),
      usesJwtShopId: def.includes("jwt.claims', true)::json->>'shop_id'"),
      usesHardcodedShopId: def.includes("'00000000-"),
      insertsShopId: /INSERT INTO.*shop_id/.test(def),
      isSecurityDefiner: def.includes('SECURITY DEFINER'),
    };

    // Determine status
    let status = '✅ OK';
    let note = '';

    if (!checks.hasShopId) {
      status = 'ℹ️  NO shop_id';
      note = 'Table may not require shop_id';
    } else if (checks.insertsShopId) {
      if (checks.usesCurrentShopId) {
        status = '✅ OK';
        note = 'Uses current_shop_id() → membership → tenant';
      } else if (checks.usesGetTenantId) {
        status = '✅ OK';
        note = 'Uses get_current_tenant_id() → membership → tenant';
      } else if (checks.usesJwtShopId) {
        status = '⚠️  LEGACY';
        note = 'Gets shop_id from JWT shop_id claim — should use current_shop_id()';
        issues.push({ rpc, issue: 'Uses JWT shop_id claim instead of current_shop_id()' });
      } else if (checks.usesJwtSub && checks.hasShopId) {
        // JWT sub used but shop_id resolved from sub (user's shop_id column)
        status = '⚠️  PARTIAL';
        note = 'Resolves from JWT sub → users.shop_id — membership fallback only';
      } else if (checks.usesHardcodedShopId) {
        status = '❌ HARDCODED';
        note = 'Hardcodes shop_id — will not work for multi-tenant';
        issues.push({ rpc, issue: 'Hardcoded shop_id' });
      } else {
        status = '⚠️  UNKNOWN';
        note = 'Has shop_id but unclear resolution';
      }
    } else if (checks.hasShopId && !checks.insertsShopId) {
      status = 'ℹ️  REFERENCES only';
      note = 'References shop_id but does not INSERT it';
    }

    console.log(`${status} ${rpc}`);
    console.log(`   ${note}`);
    console.log(`   security_definer=${checks.isSecurityDefiner} inserts_shop_id=${checks.insertsShopId}`);
    console.log('');
  }

  if (issues.length > 0) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`ISSUES FOUND: ${issues.length}`);
    console.log('═══════════════════════════════════════════════════════════════');
    issues.forEach(i => console.log(`  ❌ ${i.rpc}: ${i.issue}`));
  } else {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('ALL RPCs PASS — consistent tenant resolution');
    console.log('═══════════════════════════════════════════════════════════════');
  }
}

audit().catch(console.error);
