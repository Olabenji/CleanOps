import {
  incidentReportInputSchema,
  routeDetailSchema,
  type IncidentReportInput,
  type RouteDetail,
  type RouteStatus
} from "@cleanops/shared";
import { supabase } from "../lib/supabase";
import { withTimeout } from "../lib/withTimeout";
import { pilotDriver, pilotDriverRoute } from "./driverPilot";

const REQUEST_TIMEOUT_MS = 15_000;

export const driverCredentials = {
  email: "driver@cleanops.local",
  password: "cleanops-driver-password"
};

export type DriverSession = {
  fullName: string;
  mode: "pilot" | "supabase";
};

export async function signInDriver(): Promise<DriverSession> {
  if (!supabase) {
    return {
      fullName: pilotDriver.fullName,
      mode: "pilot"
    };
  }

  const { error } = await supabase.auth.signInWithPassword(driverCredentials);

  if (error) {
    throw new Error(error.message);
  }

  return {
    fullName: pilotDriver.fullName,
    mode: "supabase"
  };
}

export async function fetchAssignedRoute(): Promise<RouteDetail> {
  if (!supabase) {
    return pilotDriverRoute;
  }

  const { data: sessionData } = await supabase.auth.getSession();

  if (!sessionData.session) {
    throw new Error("Driver is not signed in to Supabase");
  }

  const { data, error } = await withTimeout(
    supabase.rpc("driver_assigned_route"),
    REQUEST_TIMEOUT_MS,
    "Timed out while loading assigned route"
  );

  if (error) {
    throw new Error(error.message);
  }

  if (data == null) {
    throw new Error("No route assigned today");
  }

  const parsed = routeDetailSchema.safeParse(data);

  if (!parsed.success) {
    throw new Error("Assigned route response was invalid");
  }

  return parsed.data;
}

export async function syncStopAction(
  stopId: string,
  status: "completed" | "skipped",
  note?: string,
  skipReason?: string
) {
  if (!supabase) {
    return {
      syncedAt: new Date().toISOString()
    };
  }

  const { data: sessionData } = await supabase.auth.getSession();

  if (!sessionData.session) {
    throw new Error("Driver is not signed in to Supabase");
  }

  const { data, error } = await supabase.rpc("sync_driver_stop_action", {
    input_stop_id: stopId,
    next_status: status,
    input_notes: note ?? null,
    input_skip_reason: skipReason ?? null
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as { syncedAt: string };
}

export async function transitionAssignedRoute(routeId: string, status: RouteStatus) {
  if (!supabase) {
    return;
  }

  const { data: sessionData } = await supabase.auth.getSession();

  if (!sessionData.session) {
    throw new Error("Driver is not signed in to Supabase");
  }

  const { error } = await supabase.rpc("transition_route_status", {
    input_route_id: routeId,
    next_status: status
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function reportDriverIncident(input: IncidentReportInput) {
  const parsed = incidentReportInputSchema.parse(input);

  if (!supabase) {
    return {
      createdAt: new Date().toISOString(),
      id: `${Date.now()}`
    };
  }

  const { data: sessionData } = await supabase.auth.getSession();

  if (!sessionData.session) {
    throw new Error("Driver is not signed in to Supabase");
  }

  const { data, error } = await supabase.rpc("report_driver_incident", {
    input_route_id: parsed.routeId,
    input_stop_id: parsed.stopId ?? null,
    input_incident_type: parsed.incidentType,
    input_title: parsed.title,
    input_description: parsed.description
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as { id: string; createdAt: string };
}
