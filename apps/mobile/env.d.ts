declare const process: {
  env: {
    EXPO_PUBLIC_SUPABASE_URL?: string;
    EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
    EXPO_PUBLIC_FORCE_PILOT_MODE?: string;
    /** Operator web origin for password-recovery email redirect (e.g. http://192.168.1.10:5173). */
    EXPO_PUBLIC_WEB_APP_URL?: string;
    /** Expo/EAS project id required for push tokens on physical devices. */
    EXPO_PUBLIC_EAS_PROJECT_ID?: string;
  };
};
