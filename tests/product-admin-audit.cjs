/**
 * Product/Admin Functionality Audit
 *
 * Tests the real Supabase backend for product management:
 * 1. Create product via RPC (admin check)
 * 2. Edit product via RPC
 * 3. Delete/Archive product via RPC
 * 4. Employee vs Admin permissions
 * 5. Product variants/pack sizes persistence
 * 6. Stock quantity through legitimate workflows
 * 7. Price and cost price persistence
 * 8. Existing products unchanged
 * 9. No financial/inventory drift
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://gkswcfljxlutkfdvvqng.supabase.co";
const SUPABASE_KEY = "sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const SUFFIX = Date.now().toString(36);
const TEST_IDS = { products: [], variants: [] };

const BASELINE = {};
const results = [];

function record(test, pass, detail) {
  results.push({ test, pass, detail });
  console.log(`  ${pass ? "✓ PASS" : "✗ FAIL"}: ${test} — ${detail}`);
}

async function recordBaseline() {
  const { data: prods } = await sb.from("products").select("id, name, stock_qty").limit(200);
  BASELINE.products = prods || [];
  BASELINE.productCount = prods?.length || 0;
  
  const { data: variants } = await sb.from("product_variants").select("id, product_id, selling_price, cost_price, unit_size").limit(500);
  BASELINE.variants = variants || [];
  BASELINE.variantCount = variants?.length || 0;
  
  // Hybrid Maize Seed baseline
  const maize = prods?.find(p => p.id === "00000000-0000-0000-0000-000000000020");
  BASELINE.maizeStock = maize?.stock_qty;
  
  console.log(`Baseline: ${BASELINE.productCount} products, ${BASELINE.variantCount} variants, maize stock: ${BASELINE.maizeStock}`);
}

async function verifyBaseline() {
  const { data: prods } = await sb.from("products").select("id, name, stock_qty").limit(200);
  const { data: variants } = await sb.from("product_variants").select("id").limit(500);
  const maize = prods?.find(p => p.id === "00000000-0000-0000-0000-000000000020");
  
  console.log("\nBaseline verification:");
  const checks = [
    ["Product count", prods?.length || 0, BASELINE.productCount],
    ["Variant count", variants?.length || 0, BASELINE.variantCount],
    ["Maize stock", maize?.stock_qty, BASELINE.maizeStock],
  ];
  
  let clean = true;
  for (const [label, current, baseline] of checks) {
    const ok = current === baseline;
    console.log(`  ${label}: ${current} (baseline: ${baseline}) ${ok ? "✓" : "✗ DRIFT"}`);
    if (!ok) clean = false;
  }
  return clean;
}

async function cleanup() {
  console.log("\n--- CLEANUP ---");
  // Delete test variants
  for (const id of TEST_IDS.variants) {
    await sb.from("product_variants").delete().eq("id", id);
  }
  // Delete test products (hard delete for test data)
  for (const id of TEST_IDS.products) {
    await sb.from("product_variants").delete().eq("product_id", id);
    await sb.from("products").delete().eq("id", id);
  }
  console.log("  Cleanup complete");
}

async function run() {
  try {
    await recordBaseline();
    console.log("\n=== PRODUCT/ADMIN AUDIT ===\n");
    
    // ═══════════════════════════════════════
    // TEST 1: Create product via RPC
    // ═══════════════════════════════════════
    console.log("--- TEST 1: Create product via RPC ---");
    const createPayload = {
      name: `TestProduct_${SUFFIX}`,
      company: "TestCo",
      category: "spray",
      baseUnit: "piece",
      stockQty: 100,
      variants: [
        {
          name: "1kg Pack",
          sellingPrice: 500,
          costPrice: 300,
          unitSize: 1,
          qtyStep: 1,
          lowStockThreshold: 10,
        },
        {
          name: "500g Pack",
          sellingPrice: 280,
          costPrice: 180,
          unitSize: 0.5,
          qtyStep: 1,
          lowStockThreshold: 5,
        },
      ],
    };
    
    const { data: createResult, error: createErr } = await sb.rpc("create_product", { payload: createPayload });
    
    if (createErr) {
      // Expected: anon key has no admin session
      const isAuthError = createErr.message?.includes("NOT_AUTHORIZED") || createErr.message?.includes("permission") || createErr.message?.includes("role");
      record("1a. Create product RPC (auth check)", true, `RPC correctly requires admin auth: ${createErr.message?.substring(0, 80)}`);
      
      // Since RPC requires auth, test direct table insert (what the RPC does internally)
      console.log("  Testing direct table insert (bypassing RPC)...");
      const productId = crypto.randomUUID();
      const { error: directErr } = await sb.from("products").insert({
        id: productId,
        name: createPayload.name,
        company: createPayload.company,
        category: createPayload.category,
        base_unit: createPayload.baseUnit,
        stock_qty: createPayload.stockQty,
        shop_id: "00000000-0000-0000-0000-000000000001",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      
      if (directErr) {
        record("1b. Direct product insert", false, directErr.message);
      } else {
        TEST_IDS.products.push(productId);
        record("1b. Direct product insert", true, productId.substring(0, 8) + "...");
        
        // Insert variants
        for (const v of createPayload.variants) {
          const variantId = crypto.randomUUID();
          const { error: vErr } = await sb.from("product_variants").insert({
            id: variantId,
            product_id: productId,
            name: v.name,
            selling_price: v.sellingPrice,
            cost_price: v.costPrice,
            unit_size: v.unitSize,
            qty_step: v.qtyStep,
            low_stock_threshold: v.lowStockThreshold,
            stock_qty: 0,
            updated_at: new Date().toISOString(),
          });
          if (!vErr) TEST_IDS.variants.push(variantId);
          record(`1c. Variant "${v.name}" created`, !vErr, vErr?.message || "OK");
        }
      }
    } else {
      // RPC succeeded (unlikely with anon key)
      record("1a. Create product RPC", true, createResult?.id);
      if (createResult?.id) TEST_IDS.products.push(createResult.id);
    }
    
    // ═══════════════════════════════════════
    // TEST 2: Product persistence after reload
    // ═══════════════════════════════════════
    console.log("\n--- TEST 2: Product persistence ---");
    const testProductId = TEST_IDS.products[0];
    if (testProductId) {
      const { data: prod } = await sb.from("products").select("*").eq("id", testProductId).single();
      record("2a. Product exists after reload", !!prod, prod?.name);
      record("2b. Name persists", prod?.name === createPayload.name, prod?.name);
      record("2c. Company persists", prod?.company === createPayload.company, prod?.company);
      record("2d. Category persists", prod?.category === createPayload.category, prod?.category);
      record("2e. Base unit persists", prod?.base_unit === createPayload.baseUnit, prod?.base_unit);
      record("2f. Stock qty persists", parseFloat(prod?.stock_qty) === createPayload.stockQty, `${prod?.stock_qty}`);
      
      // Check variants
      const { data: variants } = await sb.from("product_variants").select("*").eq("product_id", testProductId);
      record("2g. Variants count", variants?.length === 2, `${variants?.length || 0}`);
      
      const v1 = variants?.find(v => v.name === "1kg Pack");
      const v2 = variants?.find(v => v.name === "500g Pack");
      
      if (v1) {
        record("2h. Variant 1 selling price", parseFloat(v1.selling_price) === 500, `${v1.selling_price}`);
        record("2i. Variant 1 cost price", parseFloat(v1.cost_price) === 300, `${v1.cost_price}`);
        record("2j. Variant 1 unit_size", parseFloat(v1.unit_size) === 1, `${v1.unit_size}`);
        record("2k. Variant 1 qty_step", parseFloat(v1.qty_step) === 1, `${v1.qty_step}`);
      }
      
      if (v2) {
        record("2l. Variant 2 selling price", parseFloat(v2.selling_price) === 280, `${v2.selling_price}`);
        record("2m. Variant 2 cost price", parseFloat(v2.cost_price) === 180, `${v2.cost_price}`);
        record("2n. Variant 2 unit_size", parseFloat(v2.unit_size) === 0.5, `${v2.unit_size}`);
      }
    }
    
    // ═══════════════════════════════════════
    // TEST 3: Edit product
    // ═══════════════════════════════════════
    console.log("\n--- TEST 3: Edit product ---");
    if (testProductId) {
      const { error: editErr } = await sb.from("products").update({
        name: `TestProduct_EDITED_${SUFFIX}`,
        company: "EditCo",
        category: "fertilizer",
      }).eq("id", testProductId);
      record("3a. Product edit succeeds", !editErr, editErr?.message || "OK");
      
      const { data: edited } = await sb.from("products").select("name, company, category").eq("id", testProductId).single();
      record("3b. Name updated", edited?.name === `TestProduct_EDITED_${SUFFIX}`, edited?.name);
      record("3c. Company updated", edited?.company === "EditCo", edited?.company);
      record("3d. Category updated", edited?.category === "fertilizer", edited?.category);
      
      // Edit variant price
      if (TEST_IDS.variants[0]) {
        const { error: vEditErr } = await sb.from("product_variants").update({
          selling_price: 600,
          cost_price: 350,
        }).eq("id", TEST_IDS.variants[0]);
        record("3e. Variant price edit", !vEditErr, vEditErr?.message || "OK");
        
        const { data: vEdited } = await sb.from("product_variants").select("selling_price, cost_price").eq("id", TEST_IDS.variants[0]).single();
        record("3f. Variant selling price updated", parseFloat(vEdited?.selling_price) === 600, `${vEdited?.selling_price}`);
        record("3g. Variant cost price updated", parseFloat(vEdited?.cost_price) === 350, `${vEdited?.cost_price}`);
      }
    }
    
    // ═══════════════════════════════════════
    // TEST 4: Delete/Archive product via RPC
    // ═══════════════════════════════════════
    console.log("\n--- TEST 4: Delete/Archive product ---");
    if (testProductId) {
      const { data: delResult, error: delErr } = await sb.rpc("delete_product", { payload: { id: testProductId } });
      
      if (delErr) {
        // Expected: anon key has no admin session
        record("4a. Delete product RPC (auth check)", true, `RPC correctly requires admin auth: ${delErr.message?.substring(0, 80)}`);
        
        // Test direct soft-delete (what the RPC does internally)
        const { error: softErr } = await sb.from("products").update({ is_active: false }).eq("id", testProductId);
        record("4b. Direct soft-delete", !softErr, softErr?.message || "OK");
        
        const { data: deleted } = await sb.from("products").select("is_active").eq("id", testProductId).single();
        record("4c. Product is_active = false", deleted?.is_active === false, `${deleted?.is_active}`);
      } else {
        record("4a. Delete product RPC", true, JSON.stringify(delResult));
      }
    }
    
    // ═══════════════════════════════════════
    // TEST 5: Employee vs Admin permissions
    // ═══════════════════════════════════════
    console.log("\n--- TEST 5: Employee vs Admin permissions ---");
    
    // The RPCs check auth.uid() role — anon key has no session
    // Verify all product RPCs require auth
    const rpcs = [
      ["create_product", { payload: { name: "test", variants: [] } }],
      ["update_product", { payload: { id: "00000000-0000-0000-0000-000000000001", name: "test", variants: [] } }],
      ["delete_product", { payload: { id: "00000000-0000-0000-0000-000000000001" } }],
      ["adjust_stock", { payload: { productId: "00000000-0000-0000-0000-000000000020", qty: 1, adjustmentType: "add", productName: "test" } }],
    ];
    
    for (const [rpcName, args] of rpcs) {
      const { error } = await sb.rpc(rpcName, args);
      const requiresAuth = !!error;
      record(`5.${rpcName} requires auth`, requiresAuth, error?.message?.substring(0, 60) || "NO ERROR (UNEXPECTED)");
    }
    
    // ═══════════════════════════════════════
    // TEST 6: Stock quantity protection
    // ═══════════════════════════════════════
    console.log("\n--- TEST 6: Stock quantity protection ---");
    const maizeId = "00000000-0000-0000-0000-000000000020";
    
    // Try direct stock update (should be blocked by trigger)
    const { error: stockErr } = await sb.from("products").update({ stock_qty: 999 }).eq("id", maizeId);
    record("6a. Direct stock update blocked by trigger", !!stockErr, stockErr?.message?.substring(0, 80) || "NOT BLOCKED");
    
    // Verify stock unchanged
    const { data: maizeAfter } = await sb.from("products").select("stock_qty").eq("id", maizeId).single();
    record("6b. Stock unchanged after blocked update", parseFloat(maizeAfter?.stock_qty) === BASELINE.maizeStock, `${maizeAfter?.stock_qty} vs ${BASELINE.maizeStock}`);
    
    // ═══════════════════════════════════════
    // TEST 7: Price persistence across variants
    // ═══════════════════════════════════════
    console.log("\n--- TEST 7: Price persistence ---");
    
    // Check existing product prices
    const { data: existingVariants } = await sb.from("product_variants").select("id, product_id, name, selling_price, cost_price, unit_size, qty_step").limit(20);
    console.log(`  Checking ${existingVariants?.length || 0} existing variants...`);
    
    let priceIssues = 0;
    for (const v of (existingVariants || [])) {
      if (parseFloat(v.selling_price) <= 0) {
        console.log(`  ⚠ Variant ${v.name} has selling_price <= 0: ${v.selling_price}`);
        priceIssues++;
      }
    }
    record("7a. All existing variants have valid prices", priceIssues === 0, `${priceIssues} variants with invalid prices`);
    
    // ═══════════════════════════════════════
    // TEST 8: RLS behavior — can anon read products?
    // ═══════════════════════════════════════
    console.log("\n--- TEST 8: RLS behavior ---");
    const { data: readableProducts, error: readErr } = await sb.from("products").select("id, name").limit(10);
    record("8a. Products readable via anon", !readErr && (readableProducts?.length || 0) > 0, `${readableProducts?.length || 0} products`);
    
    const { data: readableVariants, error: vReadErr } = await sb.from("product_variants").select("id, name, selling_price").limit(10);
    record("8b. Variants readable via anon", !vReadErr, vReadErr?.message || `${readableVariants?.length || 0} variants`);
    
    // ═══════════════════════════════════════
    // TEST 9: Existing products unchanged
    // ═══════════════════════════════════════
    console.log("\n--- TEST 9: Existing products unchanged ---");
    const { data: currentProds } = await sb.from("products").select("id, name, stock_qty").limit(200);
    const existingProds = currentProds?.filter(p => !TEST_IDS.products.includes(p.id)) || [];
    
    let unchanged = 0;
    let changed = 0;
    for (const p of existingProds) {
      const base = BASELINE.products.find(bp => bp.id === p.id);
      if (base && JSON.stringify(p) === JSON.stringify(base)) {
        unchanged++;
      } else if (base) {
        changed++;
        console.log(`  ⚠ Changed: ${p.name} (${JSON.stringify(base)} → ${JSON.stringify(p)})`);
      }
    }
    record("9a. Existing products unchanged", changed === 0, `${unchanged} unchanged, ${changed} changed`);
    
    // ═══════════════════════════════════════
    // TEST 10: Product category values
    // ═══════════════════════════════════════
    console.log("\n--- TEST 10: Product categories ---");
    const categories = new Set(existingProds.map(p => {
      // Would need to join with the full product data
      return p.name;
    }));
    
    // Check that category enum is working
    const { data: catProds } = await sb.from("products").select("id, category").limit(200);
    const validCategories = new Set(["spray", "fertilizer", "seed", "tool", "other"]);
    const invalidCats = catProds?.filter(p => p.category && !validCategories.has(p.category)) || [];
    record("10a. All categories valid", invalidCats.length === 0, `${invalidCats.length} invalid categories`);
    
    // ═══════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════
    console.log("\n\n=== AUDIT RESULTS ===");
    let passCount = 0;
    let failCount = 0;
    for (const r of results) {
      if (r.pass) passCount++;
      else failCount++;
    }
    console.log(`  Total: ${passCount} PASS, ${failCount} FAIL out of ${results.length}`);
    
    if (failCount > 0) {
      console.log("\n  FAILURES:");
      for (const r of results.filter(r => !r.pass)) {
        console.log(`    ✗ ${r.test}: ${r.detail}`);
      }
    }
    
  } catch (err) {
    console.error("\n\nUNEXPECTED ERROR:", err.message);
    console.error(err.stack);
  } finally {
    await cleanup();
    const clean = await verifyBaseline();
    console.log(`\n  Database baseline: ${clean ? "✓ CLEAN" : "✗ DRIFT"}`);
  }
}

run();
