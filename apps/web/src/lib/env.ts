type WebEnv = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

export function getWebEnv(): WebEnv {
  return {
    supabaseUrl: import.meta.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  };
}

export function hasSupabaseConfig() {
  const env = getWebEnv();

  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}
