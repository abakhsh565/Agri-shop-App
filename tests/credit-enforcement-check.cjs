const { createClient } = require("@supabase/supabase-js");
const sb = createClient("https://gkswcfljxlutkfdvvqng.supabase.co", "sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG");

async function main() {
  const CUST_NO_LIMIT = { id: "310f7641-e048-4d89-b40f-4a3832dfdef0", name: "Test Customer" };
  const EMPLOYEE_ID = "00000000-0000-0000-0000-000000000002";
  const PRODUCT = { productId: "00000000-0000-0000-0000-000000000020", productName: "Hybrid Maize Seed", variantId: "00000000-0000-0000-0000-000000000032", variantName: "1kg", qty: 1, unitPrice: 100, unitSize: 1, baseUnit: "kg" };

  // Test: Customer with credit_limit=0, WITH dueDate, credit sale
  // Should fail with CREDIT_LIMIT_REQUIRED
  const { data: d1, error: e1 } = await sb.rpc("create_sale", {
    payload: {
      customerId: CUST_NO_LIMIT.id,
      customerName: CUST_NO_LIMIT.name,
      employeeId: EMPLOYEE_ID,
      employeeName: "Yaqoob Malik",
      paymentType: "partial",
      paymentMethod: "cash",
      amountPaid: 0,
      dueDate: "2026-12-31",
      items: [PRODUCT],
    },
  });
  console.log("Test A: Customer with credit_limit=0 + dueDate:", e1?.message || "NO ERROR - sale created");
  if (d1) {
    await sb.from("sale_items").delete().eq("sale_id", d1.id);
    await sb.from("sales").delete().eq("id", d1.id);
    console.log("  Cleaned up sale:", d1.saleNumber);
  }

  // Test: Customer with credit_limit=0, WITHOUT dueDate, credit sale
  // Should fail with CREDIT_LIMIT_REQUIRED (checked before DUE_DATE_REQUIRED)
  const { data: d2, error: e2 } = await sb.rpc("create_sale", {
    payload: {
      customerId: CUST_NO_LIMIT.id,
      customerName: CUST_NO_LIMIT.name,
      employeeId: EMPLOYEE_ID,
      employeeName: "Yaqoob Malik",
      paymentType: "partial",
      paymentMethod: "cash",
      amountPaid: 0,
      items: [PRODUCT],
    },
  });
  console.log("Test B: Customer with credit_limit=0, no dueDate:", e2?.message || "NO ERROR - sale created");
  if (d2) {
    await sb.from("sale_items").delete().eq("sale_id", d2.id);
    await sb.from("sales").delete().eq("id", d2.id);
    console.log("  Cleaned up sale:", d2.saleNumber);
  }
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
