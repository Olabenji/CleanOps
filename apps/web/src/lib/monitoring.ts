/**
 * Optional Sentry bootstrap for the operator web app.
 * No-ops unless EXPO_PUBLIC_SENTRY_DSN is configured.
 */
export function initWebMonitoring() {
  const dsn = import.meta.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) {
    return;
  }

  // Keep the dependency optional until a DSN is provisioned in each environment.
  console.info("[cleanops] Sentry DSN detected; wire @sentry/react when enabling production monitoring.");
}

export function captureWebException(error: unknown, context?: Record<string, unknown>) {
  if (!import.meta.env.EXPO_PUBLIC_SENTRY_DSN) {
    return;
  }

  console.error("[cleanops] monitored exception", error, context ?? {});
}
