import {
  dumpsiteRunInputSchema,
  dumpsiteRunRecordSchema,
  driverRouteNoticeSchema,
  driverTodayPlanningStatusSchema,
  driverTodayShiftSummarySchema,
  ensureDailyRoutesResultSchema,
  fuelLogInputSchema,
  fuelLogRecordSchema,
  getOperationDate,
  incidentReportInputSchema,
  routeDetailSchema,
  routeTruckHandoffSchema,
  type DriverRouteNotice,
  type DriverTodayPlanningStatus,
  type DriverTodayShiftSummary,
  type DumpsiteRunInput,
  type DumpsiteRunRecord,
  type EnsureDailyRoutesResult,
  type FuelLogInput,
  type FuelLogRecord,
  type IncidentReportInput,
  type RouteDetail,
  type RouteStatus,
  type RouteTruckHandoff
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

export async function fetchAssignedRoute(operationDate = getOperationDate()): Promise<RouteDetail | null> {
  if (!supabase) {
    return pilotDriverRoute;
  }

  const { data: sessionData } = await supabase.auth.getSession();

  if (!sessionData.session) {
    throw new Error("Driver is not signed in to Supabase");
  }

  const { data, error } = await withTimeout(
    supabase.rpc("driver_assigned_route", { input_date: operationDate }),
    REQUEST_TIMEOUT_MS,
    "Timed out while loading assigned route"
  );

  if (error) {
    throw new Error(error.message);
  }

  if (data == null) {
    return null;
  }

  const parsed = routeDetailSchema.safeParse(data);

  if (!parsed.success) {
    throw new Error("Assigned route response was invalid");
  }

  return parsed.data;
}

export async function fetchDriverTodayPlanningStatus(): Promise<DriverTodayPlanningStatus> {
  if (!supabase) {
    return {
      hasAssignedRoute: true,
      operatorRoutesExist: true,
      canLoadDefaults: false
    };
  }

  const { data, error } = await withTimeout(
    supabase.rpc("driver_today_planning_status"),
    REQUEST_TIMEOUT_MS,
    "Timed out while checking today's route status"
  );

  if (error) {
    throw new Error(error.message);
  }

  return driverTodayPlanningStatusSchema.parse(data);
}

export async function driverEnsureDailyRoutesLoaded(): Promise<EnsureDailyRoutesResult> {
  if (!supabase) {
    throw new Error("Loading default routes requires Supabase");
  }

  const { data, error } = await withTimeout(
    supabase.rpc("driver_ensure_daily_routes_loaded"),
    REQUEST_TIMEOUT_MS,
    "Timed out while loading default routes"
  );

  if (error) {
    throw new Error(error.message);
  }

  return ensureDailyRoutesResultSchema.parse(data);
}

export async function fetchPendingRouteNotices(): Promise<DriverRouteNotice[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await withTimeout(
    supabase.rpc("pending_driver_route_notices"),
    REQUEST_TIMEOUT_MS,
    "Timed out while loading route notices"
  );

  if (error) {
    throw new Error(error.message);
  }

  return driverRouteNoticeSchema.array().parse(data ?? []);
}

export async function acknowledgeRouteNotice(noticeId: string): Promise<void> {
  if (!supabase) {
    return;
  }

  const { error } = await withTimeout(
    supabase.rpc("acknowledge_driver_route_notice", { input_notice_id: noticeId }),
    REQUEST_TIMEOUT_MS,
    "Timed out while acknowledging route notice"
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function syncStopAction(
  stopId: string,
  status: "completed" | "skipped",
  note?: string,
  skipReason?: string,
  proof?: {
    latitude?: number | null;
    longitude?: number | null;
    proofPhotoPath?: string | null;
    localPhotoUri?: string;
    mimeType?: string;
  }
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

  let proofPhotoPath = proof?.proofPhotoPath ?? null;
  if (!proofPhotoPath && proof?.localPhotoUri) {
    const { getOwnAccountProfile } = await import("./profileService");
    const { uploadStopProofFromUri } = await import("./fieldProof");
    const profile = await getOwnAccountProfile();
    if (!profile.operatorId) {
      throw new Error("Operator profile required for proof photo upload");
    }
    proofPhotoPath = await uploadStopProofFromUri({
      operatorId: profile.operatorId,
      stopId,
      uri: proof.localPhotoUri,
      mimeType: proof.mimeType
    });
  }

  const { data, error } = await supabase.rpc("sync_driver_stop_action", {
    input_stop_id: stopId,
    next_status: status,
    input_notes: note ?? null,
    input_skip_reason: skipReason ?? null,
    input_latitude: proof?.latitude ?? null,
    input_longitude: proof?.longitude ?? null,
    input_proof_photo_path: proofPhotoPath
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as { syncedAt: string; proofPhotoPath?: string | null };
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

export async function fetchDumpsiteRunForRoute(routeId: string): Promise<DumpsiteRunRecord | null> {
  if (!supabase) {
    return null;
  }

  const { data: sessionData } = await supabase.auth.getSession();

  if (!sessionData.session) {
    throw new Error("Driver is not signed in to Supabase");
  }

  const { data, error } = await withTimeout(
    supabase.rpc("driver_dumpsite_run_for_route", { input_route_id: routeId }),
    REQUEST_TIMEOUT_MS,
    "Timed out while loading dumpsite run"
  );

  if (error) {
    throw new Error(error.message);
  }

  if (data == null) {
    return null;
  }

  return dumpsiteRunRecordSchema.parse(data);
}

export async function recordFuelLog(input: FuelLogInput): Promise<FuelLogRecord> {
  const parsed = fuelLogInputSchema.parse(input);

  if (!supabase) {
    return fuelLogRecordSchema.parse({
      id: "00000000-0000-4000-8000-000000000901",
      routeId: parsed.routeId,
      truckRegistration: "LAG-001-PSP",
      litres: parsed.litres,
      costKobo: parsed.costKobo,
      stationName: parsed.stationName,
      loggedAt: parsed.loggedAt ?? new Date().toISOString()
    });
  }

  const { data: sessionData } = await supabase.auth.getSession();

  if (!sessionData.session) {
    throw new Error("Driver is not signed in to Supabase");
  }

  const { data, error } = await withTimeout(
    supabase.rpc("record_fuel_log", {
      input_route_id: parsed.routeId,
      input_litres: parsed.litres,
      input_cost_kobo: parsed.costKobo,
      input_station_name: parsed.stationName,
      input_logged_at: parsed.loggedAt ?? null
    }),
    REQUEST_TIMEOUT_MS,
    "Timed out while recording fuel log"
  );

  if (error) {
    throw new Error(error.message);
  }

  return fuelLogRecordSchema.parse(data);
}

export async function recordDumpsiteRun(input: DumpsiteRunInput): Promise<DumpsiteRunRecord> {
  const parsed = dumpsiteRunInputSchema.parse(input);

  if (!supabase) {
    const now = new Date().toISOString();
    return dumpsiteRunRecordSchema.parse({
      id: "00000000-0000-4000-8000-000000000902",
      routeId: parsed.routeId,
      departedAt: parsed.phase === "depart" ? now : null,
      arrivedAt: parsed.phase === "arrive" ? now : null,
      clearedAt: parsed.phase === "clear" ? now : null,
      tippingFeeKobo: parsed.tippingFeeKobo ?? 0,
      notes: parsed.notes ?? null,
      dumpsiteSiteName: parsed.dumpsiteSiteName ?? null,
      docketNumber: parsed.docketNumber ?? null,
      weighbridgeTonnes: parsed.weighbridgeTonnes ?? null,
      ticketPhotoPath: parsed.ticketPhotoPath ?? null
    });
  }

  const { data: sessionData } = await supabase.auth.getSession();

  if (!sessionData.session) {
    throw new Error("Driver is not signed in to Supabase");
  }

  const { data, error } = await withTimeout(
    supabase.rpc("record_dumpsite_run", {
      input_route_id: parsed.routeId,
      input_phase: parsed.phase,
      input_tipping_fee_kobo: parsed.tippingFeeKobo ?? null,
      input_notes: parsed.notes ?? null,
      input_dumpsite_site_name: parsed.dumpsiteSiteName ?? null,
      input_docket_number: parsed.docketNumber ?? null,
      input_weighbridge_tonnes: parsed.weighbridgeTonnes ?? null,
      input_ticket_photo_path: parsed.ticketPhotoPath ?? null
    }),
    REQUEST_TIMEOUT_MS,
    "Timed out while recording dumpsite run"
  );

  if (error) {
    throw new Error(error.message);
  }

  return dumpsiteRunRecordSchema.parse(data);
}

export async function fetchDriverTodayShiftSummary(inputDate?: string): Promise<DriverTodayShiftSummary> {
  if (!supabase) {
    return { jobs: [] };
  }

  const { data, error } = await withTimeout(
    supabase.rpc("driver_today_shift_summary", {
      input_date: inputDate ?? getOperationDate()
    }),
    REQUEST_TIMEOUT_MS,
    "Timed out while loading today's shift summary"
  );

  if (error) {
    throw new Error(error.message);
  }

  return driverTodayShiftSummarySchema.parse(data ?? { jobs: [] });
}

export async function fetchPendingHandoffs(): Promise<RouteTruckHandoff[]> {
  if (!supabase) {
    return [];
  }

  const { data: sessionData } = await supabase.auth.getSession();

  if (!sessionData.session) {
    throw new Error("Driver is not signed in to Supabase");
  }

  const { data, error } = await withTimeout(
    supabase.rpc("pending_driver_handoffs"),
    REQUEST_TIMEOUT_MS,
    "Timed out while loading truck handoffs"
  );

  if (error) {
    throw new Error(error.message);
  }

  return routeTruckHandoffSchema.array().parse(data ?? []);
}

export async function confirmTruckHandoff(handoffId: string): Promise<RouteTruckHandoff> {
  if (!supabase) {
    throw new Error("Truck handoffs require Supabase.");
  }

  const { data: sessionData } = await supabase.auth.getSession();

  if (!sessionData.session) {
    throw new Error("Driver is not signed in to Supabase");
  }

  const { data, error } = await withTimeout(
    supabase.rpc("confirm_route_truck_handoff", { input_handoff_id: handoffId }),
    REQUEST_TIMEOUT_MS,
    "Timed out while confirming truck handoff"
  );

  if (error) {
    throw new Error(error.message);
  }

  return routeTruckHandoffSchema.parse(data);
}

export async function rejectTruckHandoff(handoffId: string, note?: string): Promise<RouteTruckHandoff> {
  if (!supabase) {
    throw new Error("Truck handoffs require Supabase.");
  }

  const { data: sessionData } = await supabase.auth.getSession();

  if (!sessionData.session) {
    throw new Error("Driver is not signed in to Supabase");
  }

  const { data, error } = await withTimeout(
    supabase.rpc("reject_route_truck_handoff", {
      input_handoff_id: handoffId,
      input_note: note ?? null
    }),
    REQUEST_TIMEOUT_MS,
    "Timed out while rejecting truck handoff"
  );

  if (error) {
    throw new Error(error.message);
  }

  return routeTruckHandoffSchema.parse(data);
}
