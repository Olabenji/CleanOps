import {
  dumpsiteSiteSchema,
  fleetMaintenanceEventSchema,
  getOperationDate,
  operatorFleetSnapshotSchema,
  recordMaintenanceEventInputSchema,
  upsertDumpsiteSiteInputSchema,
  type DumpsiteSite,
  type FleetMaintenanceEvent,
  type OperatorFleetSnapshot,
  type RecordMaintenanceEventInput,
  type UpsertDumpsiteSiteInput
} from "@cleanops/shared";
import { supabase } from "../lib/supabase";

export async function getOperatorFleet(operationDate?: string): Promise<OperatorFleetSnapshot> {
  if (!supabase) {
    return {
      operationDate: operationDate ?? getOperationDate(),
      metrics: {
        trucksTotal: 0,
        trucksOperational: 0,
        trucksStandby: 0,
        trucksWorkshop: 0,
        fuelLitresToday: 0,
        fuelSpendKoboToday: 0,
        dumpsiteInProgress: 0,
        dumpsiteClearedToday: 0,
        maintenanceEventsThisMonth: 0,
        maintenanceSpendKoboThisMonth: 0,
        dumpsiteSitesActive: 0,
        trucksStartedToday: 0,
        trucksMappedToday: 0
      },
      trucks: [],
      dumpsiteRuns: [],
      fuelLogs: [],
      maintenanceEvents: [],
      dumpsiteSites: [],
      activeTruckPositions: []
    };
  }

  const { data, error } = await supabase.rpc("operator_fleet_snapshot", {
    input_date: operationDate ?? getOperationDate()
  });

  if (error) {
    throw new Error(error.message);
  }

  return operatorFleetSnapshotSchema.parse(data);
}

export async function recordMaintenanceEvent(
  input: RecordMaintenanceEventInput
): Promise<FleetMaintenanceEvent> {
  const parsed = recordMaintenanceEventInputSchema.parse(input);
  if (!supabase) {
    throw new Error("Supabase is not configured");
  }

  const { data, error } = await supabase.rpc("record_maintenance_event", {
    input_truck_id: parsed.truckId,
    input_event_date: parsed.eventDate,
    input_work_done: parsed.workDone,
    input_workshop_name: parsed.workshopName ?? null,
    input_cost_kobo: parsed.costKobo
  });

  if (error) {
    throw new Error(error.message);
  }

  return fleetMaintenanceEventSchema.parse(data);
}

export async function upsertDumpsiteSite(input: UpsertDumpsiteSiteInput): Promise<DumpsiteSite> {
  const parsed = upsertDumpsiteSiteInputSchema.parse(input);
  if (!supabase) {
    throw new Error("Supabase is not configured");
  }

  const { data, error } = await supabase.rpc("upsert_dumpsite_site", {
    input_site_id: parsed.siteId ?? null,
    input_name: parsed.name,
    input_address: parsed.address ?? null,
    input_latitude: parsed.latitude ?? null,
    input_longitude: parsed.longitude ?? null,
    input_daily_capacity_tonnes: parsed.dailyCapacityTonnes ?? null,
    input_notes: parsed.notes ?? null,
    input_active: parsed.active ?? true
  });

  if (error) {
    throw new Error(error.message);
  }

  return dumpsiteSiteSchema.parse(data);
}
