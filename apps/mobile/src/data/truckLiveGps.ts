import { captureStopGps } from "./fieldProof";
import { supabase } from "../lib/supabase";

const DEFAULT_INTERVAL_MS = 45_000;

export type TruckLiveGpsHandle = {
  stop: () => void;
};

/**
 * While a driver route is in progress, periodically publish GPS to the fleet map.
 * Soft-fails when expo-location / permission / RPC is unavailable (dev clients, AU, etc.).
 */
export function startTruckLiveGpsPublisher(
  routeId: string,
  options?: { intervalMs?: number; onStatus?: (message: string | null) => void }
): TruckLiveGpsHandle {
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  let stopped = false;
  let inFlight = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function publishOnce() {
    if (stopped || inFlight || !supabase) {
      return;
    }

    inFlight = true;
    try {
      const gps = await captureStopGps();
      if (gps.latitude == null || gps.longitude == null) {
        options?.onStatus?.("Live GPS unavailable on this device build");
        return;
      }

      const { error } = await supabase.rpc("publish_truck_live_position", {
        input_latitude: gps.latitude,
        input_longitude: gps.longitude,
        input_route_id: routeId
      });

      if (error) {
        options?.onStatus?.(`Live GPS: ${error.message}`);
        return;
      }

      options?.onStatus?.(null);
    } catch (error) {
      options?.onStatus?.(
        error instanceof Error ? `Live GPS: ${error.message}` : "Live GPS publish failed"
      );
    } finally {
      inFlight = false;
    }
  }

  void publishOnce();
  timer = setInterval(() => {
    void publishOnce();
  }, intervalMs);

  return {
    stop: () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  };
}
