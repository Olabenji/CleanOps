import { operatorDashboardSchema, type OperatorDashboard } from "@cleanops/shared";
import { supabase } from "../lib/supabase";
import { getPilotDashboard } from "./pilotWorkflows";

function emptyDashboard(operatorName = "Operator"): OperatorDashboard {
  return {
    operatorName,
    metrics: [
      {
        label: "Route Progress",
        value: "0 / 0 stops",
        helper: "No routes planned for this date"
      },
      {
        label: "Payments",
        value: "₦0",
        helper: "No payments recorded for this date"
      },
      {
        label: "Staff Checked In",
        value: "0 / 0",
        helper: "No attendance logged for this date"
      },
      {
        label: "Open Incidents",
        value: "0 open",
        helper: "No unresolved incidents"
      }
    ],
    routes: [],
    recentPayments: [],
    staffAttendance: {
      totalStaff: 0,
      checkedIn: 0,
      absent: 0
    },
    fleet: [],
    alerts: []
  };
}

export async function getOperatorDashboard(operationDate = new Date().toISOString().slice(0, 10)): Promise<OperatorDashboard> {
  if (!supabase) {
    return getPilotDashboard();
  }

  const { data, error } = await supabase.rpc("operator_dashboard_snapshot", {
    input_date: operationDate
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return emptyDashboard();
  }

  const parsed = operatorDashboardSchema.safeParse(data);

  if (!parsed.success) {
    throw new Error("Unable to parse operator dashboard snapshot");
  }

  return parsed.data;
}
