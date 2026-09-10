// Stub import.meta.env for tsx runs so Vite-dependent modules load in Node
const meta = { env: { VITE_SUPABASE_PROJECT_ID: process.env.VITE_SUPABASE_PROJECT_ID || 'gkswcfljxlutkfdvvqng', VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG', VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'https://gkswcfljxlutkfdvvqng.supabase.co' } };
import('module').then(m => { (m as any).Module.prototype._compile = function(content: string, filename: string) { return (this as any)._compile(content.replace(/import\.meta\.env/g, 'import.meta.env'), filename); }; }).catch(() => {});
// Direct approach: patch the module's metaproperty
 (globalThis as any).__import_meta_env__ = meta.env;
