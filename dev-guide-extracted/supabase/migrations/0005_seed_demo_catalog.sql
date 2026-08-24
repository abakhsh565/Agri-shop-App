-- ============================================================================
-- AgriShop — migration 0005: OPTIONAL starter catalogue
-- ----------------------------------------------------------------------------
-- The app now runs on real data. A brand-new database has no products or
-- suppliers, so the catalogue screens would start empty. Run this ONCE if you
-- want a small realistic starter set to test with; skip it if you'd rather
-- enter your own data in-app.
--
-- Safe to skip. Re-running is a no-op (guarded by name checks). Delete these
-- rows anytime from the Supabase Table Editor — they are ordinary data.
-- ============================================================================

-- ---- Suppliers -------------------------------------------------------------
insert into companies (name, contact_person, phone, address)
select v.name, v.cp, v.phone, v.addr
from (values
  ('Syngenta Pakistan', 'Imran Khan',  '03001234567', 'Lahore'),
  ('Engro Fertilizers', 'Ayesha Malik','03007654321', 'Karachi'),
  ('FMC United',        'Bilal Ahmed', '03009998877', 'Multan')
) as v(name, cp, phone, addr)
where not exists (select 1 from companies c where c.name = v.name);

-- ---- Products + variants ---------------------------------------------------
-- Each product gets 1–2 variants with sane selling/cost/stock values.
do $$
declare
  v_prod uuid;
begin
  if not exists (select 1 from products where name = 'Karate Insecticide') then
    insert into products (name, company, category)
    values ('Karate Insecticide', 'Syngenta Pakistan', 'spray') returning id into v_prod;
    insert into product_variants (product_id, name, selling_price, cost_price, stock_qty, low_stock_threshold)
    values (v_prod, '250ml', 1200, 850, 40, 5),
           (v_prod, '500ml', 2100, 1550, 25, 5);
  end if;

  if not exists (select 1 from products where name = 'Urea Fertilizer') then
    insert into products (name, company, category)
    values ('Urea Fertilizer', 'Engro Fertilizers', 'fertilizer') returning id into v_prod;
    insert into product_variants (product_id, name, selling_price, cost_price, stock_qty, low_stock_threshold)
    values (v_prod, '50kg bag', 4500, 4100, 60, 10);
  end if;

  if not exists (select 1 from products where name = 'Hybrid Maize Seed') then
    insert into products (name, company, category)
    values ('Hybrid Maize Seed', 'FMC United', 'seed') returning id into v_prod;
    insert into product_variants (product_id, name, selling_price, cost_price, stock_qty, low_stock_threshold)
    values (v_prod, '10kg', 8500, 7200, 15, 5),
           (v_prod, '5kg', 4400, 3700, 30, 5);
  end if;
end $$;

-- ============================================================================
-- After running: the inventory / product screens show this starter catalogue.
-- Customers and sales are created through the app.
-- ============================================================================
