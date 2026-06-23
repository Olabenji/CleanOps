import { operatorDashboardSchema, type OperatorDashboard } from "@cleanops/shared";
import { pilotDashboard } from "./pilotDashboard";
import { supabase } from "../lib/supabase";
import { getPilotDashboard } from "./pilotWorkflows";

export async function getOperatorDashboard(operationDate = new Date().toISOString().slice(0, 10)): Promise<OperatorDashboard> {
  if (!supabase) {
    return getPilotDashboard();
  }

  const { data, error } = await supabase.rpc("operator_dashboard_snapshot", {
    input_date: operationDate
  });

  if (error || !data) {
    return pilotDashboard;
  }

  const parsed = operatorDashboardSchema.safeParse(data);

  return parsed.success ? parsed.data : pilotDashboard;
}
