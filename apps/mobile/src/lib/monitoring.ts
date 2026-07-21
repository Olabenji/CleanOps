/**
 * Optional Sentry bootstrap for the mobile field app.
 * No-ops unless EXPO_PUBLIC_SENTRY_DSN is configured.
 */
export function initMobileMonitoring() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) {
    return;
  }

  console.info(
    "[cleanops] Sentry DSN detected; wire @sentry/react-native when enabling production monitoring."
  );
}

export function captureMobileException(error: unknown, context?: Record<string, unknown>) {
  if (!process.env.EXPO_PUBLIC_SENTRY_DSN) {
    return;
  }

  console.error("[cleanops] monitored exception", error, context ?? {});
}
