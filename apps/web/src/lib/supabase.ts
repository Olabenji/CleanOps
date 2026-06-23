import { createClient } from "@supabase/supabase-js";
import { getWebEnv, hasSupabaseConfig } from "./env";

export const supabase = (() => {
  if (!hasSupabaseConfig()) {
    return null;
  }

  const env = getWebEnv();

  return createClient(env.supabaseUrl!, env.supabaseAnonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true
    }
  });
})();
