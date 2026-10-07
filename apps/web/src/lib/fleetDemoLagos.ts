/**
 * Fleet map Lagos demo pins — for AU/dev phones whose device GPS would
 * place trucks in Australia while tip sites are in Lagos.
 *
 * Enable (first match wins):
 * 1. VITE_FLEET_DEMO_LAGOS_PINS=true|false  (forces on/off; no UI override)
 * 2. localStorage key cleanops.fleet.demoLagosPins = "1"|"0"
 * 3. Default: ON in Vite DEV, OFF in production builds
 */

export const FLEET_DEMO_LAGOS_STORAGE_KEY = "cleanops.fleet.demoLagosPins";

/** Rough Lagos mainland box (Surulere–Ikeja corridor). */
export const LAGOS_DEMO_BOUNDS = {
  minLat: 6.45,
  maxLat: 6.58,
  minLng: 3.3,
  maxLng: 3.45
} as const;

export type LatLng = { latitude: number; longitude: number };

export type FleetDemoLagosResolution = {
  enabled: boolean;
  /** Env forced the value; UI toggle is locked. */
  forcedByEnv: boolean;
  source: "env" | "localStorage" | "dev-default" | "prod-default";
};

function readEnvFlag(): boolean | null {
  const raw = import.meta.env.VITE_FLEET_DEMO_LAGOS_PINS;
  if (raw == null || String(raw).trim() === "") {
    return null;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return null;
}

export function readFleetDemoLagosPreference(): boolean | null {
  try {
    const value = localStorage.getItem(FLEET_DEMO_LAGOS_STORAGE_KEY);
    if (value === "1") {
      return true;
    }
    if (value === "0") {
      return false;
    }
  } catch {
    /* ignore private-mode / SSR */
  }
  return null;
}

export function writeFleetDemoLagosPreference(enabled: boolean) {
  try {
    localStorage.setItem(FLEET_DEMO_LAGOS_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function resolveFleetDemoLagos(preference?: boolean | null): FleetDemoLagosResolution {
  const env = readEnvFlag();
  if (env != null) {
    return { enabled: env, forcedByEnv: true, source: "env" };
  }

  const stored = preference === undefined ? readFleetDemoLagosPreference() : preference;
  if (stored != null) {
    return { enabled: stored, forcedByEnv: false, source: "localStorage" };
  }

  if (import.meta.env.DEV) {
    return { enabled: true, forcedByEnv: false, source: "dev-default" };
  }

  return { enabled: false, forcedByEnv: false, source: "prod-default" };
}

/** Nigeria bbox — used to detect AU/other GPS that should be replaced in demo mode. */
export function isInNigeria(latitude: number, longitude: number) {
  return latitude >= 4 && latitude <= 14 && longitude >= 2.5 && longitude <= 15;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Stable pseudo-random Lagos coords for an id (truckId / siteId).
 * Prefer jitter around tip anchors when available so trucks sit near dumpsites.
 */
export function demoLagosCoordsForId(
  id: string,
  tipAnchors: LatLng[] = []
): LatLng {
  const hash = hashString(id);
  const u1 = (hash & 0xffff) / 0xffff;
  const u2 = ((hash >>> 16) & 0xffff) / 0xffff;

  if (tipAnchors.length > 0) {
    const tip = tipAnchors[hash % tipAnchors.length];
    // ~±2 km jitter so trucks don't stack on the tip pin
    const jitterLat = (u1 - 0.5) * 0.036;
    const jitterLng = (u2 - 0.5) * 0.036;
    return {
      latitude: tip.latitude + jitterLat,
      longitude: tip.longitude + jitterLng
    };
  }

  return {
    latitude:
      LAGOS_DEMO_BOUNDS.minLat +
      u1 * (LAGOS_DEMO_BOUNDS.maxLat - LAGOS_DEMO_BOUNDS.minLat),
    longitude:
      LAGOS_DEMO_BOUNDS.minLng +
      u2 * (LAGOS_DEMO_BOUNDS.maxLng - LAGOS_DEMO_BOUNDS.minLng)
  };
}
