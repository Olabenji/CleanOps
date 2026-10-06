type WebEnv = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /** Force Fleet map Lagos demo pins (true/false). Unset = DEV on / prod off + UI toggle. */
  fleetDemoLagosPins?: string;
};

export function getWebEnv(): WebEnv {
  return {
    supabaseUrl: import.meta.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    fleetDemoLagosPins: import.meta.env.VITE_FLEET_DEMO_LAGOS_PINS
  };
}

export function hasSupabaseConfig() {
  const env = getWebEnv();

  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}
