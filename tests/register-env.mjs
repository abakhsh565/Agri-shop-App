// Register hook to set import.meta.env for Vite modules
import { register } from "node:module";

// Set import.meta.env before any modules load
import.meta.env = import.meta.env || {};
import.meta.env.VITE_SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID || "gkswcfljxlutkfdvvqng";
import.meta.env.VITE_SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG";
import.meta.env.VITE_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://gkswcfljxlutkfdvvqng.supabase.co";
