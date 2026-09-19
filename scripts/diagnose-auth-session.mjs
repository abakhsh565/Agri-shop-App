/**
 * Diagnose why the browser client has no Supabase Auth session.
 * Attempts the same deterministic sign-in the app performs at OTP verification.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.qa', 'utf8').split('\n')) {
  if (!line.includes('=')) continue;
  const key = line.split('=')[0].trim();
  env[key] = line.split('=').slice(1).join('=').trim();
}

const url = (env.QA_SUPABASE_URL || '').replace(/^\[|\]$/g, '');
const anon = (env.QA_SUPABASE_ANON_KEY || '').replace(/^\[|\]$/g, '');
console.log('project:', url);

const phones = ['923001234567', '923001122334'];
const client = createClient(url, anon);

for (const phone of phones) {
  const email = `user-${phone}@agrishop.auth.local`;
  const password = `AgriShop-${phone}-2026!`;
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    console.log(`${phone}: SIGN-IN FAILED → ${error.message} (status ${error.status})`);
  } else {
    const payload = JSON.parse(Buffer.from(data.session.access_token.split('.')[1], 'base64').toString());
    console.log(`${phone}: SIGN-IN OK → sub=${payload.sub} role=${payload.role}`);
    await client.auth.signOut();
  }
}
