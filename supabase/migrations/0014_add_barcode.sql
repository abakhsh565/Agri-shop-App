-- Add barcode column to products table
-- Each product gets a unique barcode (Code128 format: AGS-XXXX-NN)

ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode text;

-- Create unique index on barcode (allows NULL for existing products)
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode) WHERE barcode IS NOT NULL;

-- Auto-generate barcodes for existing products that don't have one
-- Format: AGS-{FIRST4_UPPERCASE}-{SEQUENCE}
WITH numbered AS (
  SELECT
    id,
    name,
    ROW_NUMBER() OVER (ORDER BY created_at, id) AS seq
  FROM products
  WHERE barcode IS NULL
)
UPDATE products p
SET barcode = 'AGS-' || UPPER(LEFT(REGEXP_REPLACE(n.name, '[^a-zA-Z0-9]', '', 'g'), 4)) || '-' || LPAD(n.seq::text, 2, '0')
FROM numbered n
WHERE p.id = n.id;

-- RPC: Generate a unique barcode for a new product
CREATE OR REPLACE FUNCTION generate_barcode(p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_seq int;
  v_barcode text;
BEGIN
  -- Extract first 4 alphanumeric characters from product name
  v_hash := UPPER(LEFT(REGEXP_REPLACE(p_name, '[^a-zA-Z0-9]', '', 'g'), 4));
  IF LENGTH(v_hash) < 4 THEN v_hash := v_hash || RPAD('X', 4 - LENGTH(v_hash), 'X'); END IF;

  -- Get next sequence number for this hash
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(barcode FROM 10 FOR 2) AS int)
  ), 0) + 1
  INTO v_seq
  FROM products
  WHERE barcode LIKE 'AGS-' || v_hash || '-%';

  v_barcode := 'AGS-' || v_hash || '-' || LPAD(v_seq::text, 2, '0');

  -- Ensure uniqueness (collision check)
  WHILE EXISTS (SELECT 1 FROM products WHERE barcode = v_barcode) LOOP
    v_seq := v_seq + 1;
    v_barcode := 'AGS-' || v_hash || '-' || LPAD(v_seq::text, 2, '0');
  END LOOP;

  RETURN v_barcode;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_barcode(text) TO authenticated;

-- RPC: Lookup product by barcode
CREATE OR REPLACE FUNCTION lookup_product_by_barcode(p_barcode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'company', p.company,
    'category', p.category,
    'image_url', p.image_url,
    'barcode', p.barcode
  )
  INTO v_product
  FROM products p
  WHERE UPPER(p.barcode) = UPPER(p_barcode)
    AND p.is_active = true;

  IF v_product IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  RETURN v_product;
END;
$$;

GRANT EXECUTE ON FUNCTION lookup_product_by_barcode(text) TO authenticated;
