-- Add due_date column to customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS due_date date;

-- Reminder configurations (multiple per customer)
CREATE TABLE IF NOT EXISTS reminder_configs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  enabled boolean DEFAULT true,
  start_days integer DEFAULT 1,
  anchor text NOT NULL DEFAULT 'after_credit',
  repeat_type text NOT NULL DEFAULT 'escalate',
  interval_n integer DEFAULT 7,
  interval_unit text DEFAULT 'days',
  escalation jsonb DEFAULT '[]'::jsonb,
  ends text DEFAULT 'paid',
  ends_date date,
  ends_count integer DEFAULT 5,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reminder_configs_customer ON reminder_configs(customer_id);

-- Customer crop assignments
CREATE TABLE IF NOT EXISTS customer_crops (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  crop_name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(customer_id, crop_name)
);

CREATE INDEX IF NOT EXISTS idx_customer_crops_customer ON customer_crops(customer_id);

-- Business settings (singleton or per-owner)
CREATE TABLE IF NOT EXISTS business_settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid,
  crops jsonb DEFAULT '[]'::jsonb,
  updated_at timestamptz DEFAULT now()
);

-- Reminder logs (sent history)
CREATE TABLE IF NOT EXISTS reminder_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  customer_name text,
  config_id text,
  tone text,
  message text,
  channel text,
  sent_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reminder_logs_customer ON reminder_logs(customer_id);

-- RLS policies
ALTER TABLE reminder_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_crops ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_logs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access (matching existing patterns)
CREATE POLICY "reminder_configs_all" ON reminder_configs FOR ALL USING (true);
CREATE POLICY "customer_crops_all" ON customer_crops FOR ALL USING (true);
CREATE POLICY "business_settings_all" ON business_settings FOR ALL USING (true);
CREATE POLICY "reminder_logs_all" ON reminder_logs FOR ALL USING (true);
