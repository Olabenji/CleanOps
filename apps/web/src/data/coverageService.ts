import {
  getOperationDate,
  operatorCoverageSnapshotSchema,
  type OperatorCoverageSnapshot
} from "@cleanops/shared";
import { supabase } from "../lib/supabase";

export async function getOperatorCoverage(
  operationDate?: string
): Promise<OperatorCoverageSnapshot> {
  if (!supabase) {
    return {
      operationDate: operationDate ?? getOperationDate(),
      metrics: {
        dueToday: 0,
        completedToday: 0,
        open: 0,
        scheduled: 0,
        overdue: 0,
        completedRecent: 0,
        stopsDueToday: 0,
        stopsCompletedToday: 0,
        makeGoodStopsToday: 0
      },
      items: []
    };
  }

  const { data, error } = await supabase.rpc("operator_coverage_snapshot", {
    input_date: operationDate ?? getOperationDate()
  });

  if (error) {
    throw new Error(error.message);
  }

  return operatorCoverageSnapshotSchema.parse(data);
}
