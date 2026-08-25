-- Shop onboarding requests table
-- Owners submit registration requests, admins review/approve/reject

CREATE TABLE IF NOT EXISTS shop_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Owner info
  owner_name varchar(255) NOT NULL,
  owner_phone varchar(20) NOT NULL,
  
  -- Shop info
  shop_name varchar(255) NOT NULL,
  shop_address text,
  shop_city varchar(100),
  shop_type varchar(50) DEFAULT 'retail', -- retail, wholesale, both
  business_registration_number varchar(100),
  
  -- Documents (stored as URLs in Supabase Storage)
  logo_url text,
  cnic_front_url text,
  cnic_back_url text,
  business_license_url text,
  
  -- Status tracking
  status varchar(20) NOT NULL DEFAULT 'pending',
  -- 'pending' | 'under_review' | 'approved' | 'rejected'
  
  -- Admin review
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint on owner phone (one request per phone)
CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_requests_phone ON shop_requests(owner_phone);

-- Status index for admin dashboard queries
CREATE INDEX IF NOT EXISTS idx_shop_requests_status ON shop_requests(status);

-- RLS policies
ALTER TABLE shop_requests ENABLE ROW LEVEL SECURITY;

-- Anyone can insert (for registration)
CREATE POLICY shop_requests_insert ON shop_requests 
  FOR INSERT 
  WITH CHECK (true);

-- Owners can read their own requests
CREATE POLICY shop_requests_select_own ON shop_requests 
  FOR SELECT 
  USING (owner_phone = current_setting('request.headers')::json->>'x-phone');

-- Admins can read all requests (handled by app_is_admin function)
CREATE POLICY shop_requests_select_admin ON shop_requests 
  FOR SELECT 
  USING (app_is_admin());

-- Admins can update requests (approve/reject)
CREATE POLICY shop_requests_update_admin ON shop_requests 
  FOR UPDATE 
  USING (app_is_admin())
  WITH CHECK (app_is_admin());

-- Add onboarding_completed flag to shops table
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shops' AND column_name='onboarding_completed') THEN
    ALTER TABLE shops ADD COLUMN onboarding_completed boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shops' AND column_name='onboarding_step') THEN
    ALTER TABLE shops ADD COLUMN onboarding_step integer DEFAULT 0;
  END IF;
END $$;

-- Function to approve shop request and create shop + admin user
CREATE OR REPLACE FUNCTION approve_shop_request(
  request_id uuid,
  admin_id uuid
) RETURNS jsonb AS $$
DECLARE
  req_record RECORD;
  new_shop_id uuid;
  new_user_id uuid;
  result jsonb;
BEGIN
  -- Get the request
  SELECT * INTO req_record FROM shop_requests WHERE id = request_id AND status = 'pending';
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found or already processed');
  END IF;
  
  -- Create shop
  new_shop_id := gen_random_uuid();
  INSERT INTO shops (id, name, onboarding_completed, onboarding_step)
  VALUES (new_shop_id, req_record.shop_name, false, 0);
  
  -- Create admin user for the shop
  new_user_id := gen_random_uuid();
  INSERT INTO users (
    id, name, phone, role, is_original_owner, is_active, 
    employee_number, shop_id, created_by
  ) VALUES (
    new_user_id,
    req_record.owner_name,
    req_record.owner_phone,
    'admin',
    true,
    true,
    'EMP-001',
    new_shop_id,
    admin_id
  );
  
  -- Update request status
  UPDATE shop_requests 
  SET status = 'approved',
      reviewed_by = admin_id,
      reviewed_at = now(),
      updated_at = now()
  WHERE id = request_id;
  
  result := jsonb_build_object(
    'success', true,
    'shop_id', new_shop_id,
    'user_id', new_user_id,
    'shop_name', req_record.shop_name,
    'owner_name', req_record.owner_name
  );
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to reject shop request
CREATE OR REPLACE FUNCTION reject_shop_request(
  request_id uuid,
  admin_id uuid,
  reason text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  req_record RECORD;
BEGIN
  -- Get the request
  SELECT * INTO req_record FROM shop_requests WHERE id = request_id AND status IN ('pending', 'under_review');
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found or already processed');
  END IF;
  
  -- Update request status
  UPDATE shop_requests 
  SET status = 'rejected',
      reviewed_by = admin_id,
      reviewed_at = now(),
      rejection_reason = reason,
      updated_at = now()
  WHERE id = request_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'owner_name', req_record.owner_name,
    'shop_name', req_record.shop_name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
