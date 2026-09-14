/**
 * Draft-Scoped Test Data
 *
 * Generates unique test record IDs and names per draft, ensuring
 * Draft A's test data never appears in Draft B's queries and vice versa.
 *
 * Each draft gets:
 *   - A unique 8-char slug prefix (e.g., "a3x7k2b1")
 *   - UUIDs derived from the slug ( deterministic per draft )
 *   - Names prefixed with the slug for easy identification
 *   - A cleanup function that removes ONLY that draft's data
 *
 * Usage in draft verification:
 *   const draft = getDraftScope('draft-a');
 *   await draft.createCustomer(...);  // name includes slug
 *   await draft.cleanup();            // removes only draft-a's data
 */

import { execSqlAsAdmin } from './qa-client';

export interface DraftScope {
  slug: string;
  prefix: string;
  /** Deterministic UUID for a given entity type within this draft */
  uuid: (entity: string) => string;
  /** Prefixed name for easy identification */
  name: (entity: string) => string;
  /** Create a test customer in the QA DB */
  createCustomer: (name: string, phone: string) => Promise<string>;
  /** Create a test product in the QA DB */
  createProduct: (name: string) => Promise<string>;
  /** Remove ALL test data created by this draft */
  cleanup: () => Promise<void>;
}

/**
 * Generate a deterministic draft scope from a draft slug.
 * The same slug always produces the same prefix and UUIDs.
 */
export function getDraftScope(draftSlug: string): DraftScope {
  // Generate a stable 8-char prefix from the draft slug
  const hash = simpleHash(draftSlug);
  const prefix = hash.substring(0, 8);

  function simpleHash(s: string): string {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const hex1 = Math.abs(h1).toString(16).padStart(8, '0');
    const hex2 = Math.abs(h2).toString(16).padStart(8, '0');
    return (hex1 + hex2 + hex1 + hex2).substring(0, 32);
  }

  function uuid(entity: string): string {
    // Include slug in hash so different drafts produce different UUIDs
    const entityHash = simpleHash(draftSlug + ':' + entity);
    // Generate valid UUID v4 format: 8-4-4-4-12 hex chars
    return `${entityHash.substring(0, 8)}-${entityHash.substring(8, 12)}-4${entityHash.substring(13, 16)}-${entityHash.substring(16, 20)}-${entityHash.substring(20, 32)}`;
  }

  function name(entity: string): string {
    return `[${prefix}] ${entity}`;
  }

  const shopId = uuid('shop');

  async function createCustomer(custName: string, phone: string): Promise<string> {
    const id = uuid('customer-' + custName);
    await execSqlAsAdmin(`
      INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
      VALUES ('${id}', '${name(custName)}', '${phone}', 50000, 0, 0, 0, '${shopId}', 'QA')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
    `);
    return id;
  }

  async function createProduct(prodName: string): Promise<string> {
    // Ensure shop exists
    await execSqlAsAdmin(`
      INSERT INTO shops (id, name, owner_name, phone) VALUES ('${shopId}', '${name("Shop")}', 'QA', '000000')
      ON CONFLICT (id) DO NOTHING
    `).catch(() => {});
    // Ensure company exists
    const companyId = uuid('company');
    await execSqlAsAdmin(`
      INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id)
      VALUES ('${companyId}', '${name("Supplier")}', 0, 0, '${shopId}')
      ON CONFLICT (id) DO NOTHING
    `).catch(() => {});
    // Create product
    const productId = uuid('product-' + prodName);
    await execSqlAsAdmin(`
      INSERT INTO products (id, name, company_id, category, stock_qty, shop_id)
      VALUES ('${productId}', '${name(prodName)}', '${companyId}', 'seed', 100, '${shopId}')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true
    `);
    return productId;
  }

  async function cleanup(): Promise<void> {
    const q = async (sql: string) => { try { await execSqlAsAdmin(sql); } catch {} };
    // Delete all records with this draft's prefix in the name
    for (const t of ['sale_items', 'sales', 'return_items', 'returns', 'voids',
                      'customer_payments', 'credit_limit_requests', 'inventory_movements',
                      'stock_adjustments', 'reminder_configs', 'reminder_occurrences']) {
      await q(`DELETE FROM ${t} WHERE shop_id = '${shopId}'`);
    }
    await q(`DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE name LIKE '[${prefix}]%')`);
    await q(`DELETE FROM products WHERE name LIKE '[${prefix}]%'`);
    await q(`DELETE FROM companies WHERE name LIKE '[${prefix}]%'`);
    await q(`DELETE FROM customers WHERE name LIKE '[${prefix}]%'`);
    await q(`DELETE FROM users WHERE name LIKE '[${prefix}]%'`);
    await q(`DELETE FROM shops WHERE id = '${shopId}'`);
  }

  return { slug: draftSlug, prefix, uuid, name, createCustomer, createProduct, cleanup };
}
