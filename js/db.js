import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// window.supabase đến từ bản UMD nạp trong <head> (ghim phiên bản, SPEC 3)
export const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
