// Make import.meta.env available for Vite-dependent modules when running under tsx in Node
const env = {
  VITE_SUPABASE_PROJECT_ID: process.env.VITE_SUPABASE_PROJECT_ID || 'gkswcfljxlutkfdvvqng',
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG',
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'https://gkswcfljxlutkfdvvqng.supabase.co',
};
// HACK: tsx uses esbuild which respects import.meta.env if we set it on the module's meta
// We patch by defining it on the global before modules load
(globalThis as any).__VITE_META_ENV__ = env;
// Also try the standard approach: esbuild looks for import.meta.env
// In tsx, this is handled via the loader. We set process.env so esbuild picks it up.
for (const [k, v] of Object.entries(env)) {
  process.env['VITE_' + k.replace('VITE_', '')] = v;
}
