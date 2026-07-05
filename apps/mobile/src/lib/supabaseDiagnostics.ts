import { hasSupabaseConfig, supabase, supabaseDisplayUrl } from "./supabase";
import { withTimeout } from "./withTimeout";

export type SupabaseConnectionProbe = {
  configured: boolean;
  url: string | null;
  reachable: boolean;
  statusCode: number | null;
  error: string | null;
  latencyMs: number | null;
};

export async function probeSupabaseConnection(timeoutMs = 5_000): Promise<SupabaseConnectionProbe> {
  if (!hasSupabaseConfig || !supabase) {
    return {
      configured: false,
      url: supabaseDisplayUrl,
      reachable: false,
      statusCode: null,
      error: "Supabase env vars are not configured in the mobile bundle.",
      latencyMs: null
    };
  }

  const startedAt = Date.now();
  const healthUrl = `${process.env.EXPO_PUBLIC_SUPABASE_URL!.replace(/\/$/, "")}/auth/v1/health`;

  try {
    const response = await withTimeout(
      fetch(healthUrl, {
        headers: {
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!
        }
      }),
      timeoutMs,
      "Timed out while checking Supabase"
    );

    return {
      configured: true,
      url: supabaseDisplayUrl,
      reachable: response.ok,
      statusCode: response.status,
      error: response.ok ? null : `Health check returned HTTP ${response.status}`,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      configured: true,
      url: supabaseDisplayUrl,
      reachable: false,
      statusCode: null,
      error: error instanceof Error ? error.message : "Unable to reach Supabase",
      latencyMs: Date.now() - startedAt
    };
  }
}

export function formatConnectionProbe(probe: SupabaseConnectionProbe): string {
  if (!probe.configured) {
    return "Supabase is not configured in this app build.";
  }

  if (probe.reachable) {
    return `Connected to ${probe.url} (${probe.latencyMs ?? "?"}ms).`;
  }

  return `Cannot reach ${probe.url ?? "Supabase"}: ${probe.error ?? "unknown error"}`;
}
