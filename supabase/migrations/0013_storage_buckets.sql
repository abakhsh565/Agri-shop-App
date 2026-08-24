-- Migration 0013: Storage buckets for image uploads
-- Run this AFTER all other migrations on Supabase SQL Editor

-- Create storage buckets (idempotent)
INSERT INTO storage.buckets (id, name, public) VALUES
  ('product-images', 'product-images', true),
  ('employee-photos', 'employee-photos', true),
  ('company-logos', 'company-logos', true),
  ('customer-images', 'customer-images', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies: authenticated users can upload, anyone can read public buckets
-- Upload policy (authenticated only)
CREATE POLICY "Authenticated users can upload images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id IN ('product-images', 'employee-photos', 'company-logos', 'customer-images'));

-- Read policy (public access for these buckets)
CREATE POLICY "Public read access for image buckets"
ON storage.objects FOR SELECT TO public
USING (bucket_id IN ('product-images', 'employee-photos', 'company-logos', 'customer-images'));

-- Update policy (authenticated can update their own uploads)
CREATE POLICY "Authenticated users can update their uploads"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id IN ('product-images', 'employee-photos', 'company-logos', 'customer-images'));

-- Delete policy (authenticated can delete their own uploads)
CREATE POLICY "Authenticated users can delete their uploads"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id IN ('product-images', 'employee-photos', 'company-logos', 'customer-images'));
