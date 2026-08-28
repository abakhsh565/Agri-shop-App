-- Allow all authenticated/anon users to update products (name, image only)
-- This enables employees to edit product details from the Product Detail page
-- The full create/delete is still admin-only via separate policies

-- Drop the restrictive admin-only update policy if it exists
DROP POLICY IF EXISTS products_admin_update ON products;
DROP POLICY IF EXISTS "products_admin_update" ON products;

-- Create permissive update policy for all users
CREATE POLICY "products_update_all" ON products
  FOR UPDATE
  USING (true)
  WITH CHECK (true);
