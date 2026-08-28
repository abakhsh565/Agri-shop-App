-- Force drop and recreate the products update policy
-- This handles cases where the policy name varies (quoted vs unquoted)

DO $$ 
BEGIN
  -- Drop all existing update policies on products
  DROP POLICY IF EXISTS products_admin_update ON products;
  DROP POLICY IF EXISTS "products_admin_update" ON products;
  DROP POLICY IF EXISTS products_update_all ON products;
  DROP POLICY IF EXISTS "products_update_all" ON products;
  DROP POLICY IF EXISTS products_owner_update ON products;
  DROP POLICY IF EXISTS "products_owner_update" ON products;
END $$;

-- Create a single permissive policy that allows any authenticated user to update products
CREATE POLICY "products_update_all" ON products
  FOR UPDATE
  USING (true)
  WITH CHECK (true);
