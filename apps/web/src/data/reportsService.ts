import {
  operatorReportsSnapshotSchema,
  type OperatorReportsSnapshot,
  type ReportLawmaSummary
} from "@cleanops/shared";
import { supabase } from "../lib/supabase";

const emptyLawmaSummary = (): ReportLawmaSummary => ({
  stopsPlanned: 0,
  stopsCompleted: 0,
  stopsMissed: 0,
  coveragePercent: 0,
  weighbridgeTonnes: 0,
  disposalTips: 0,
  tipsWithDocket: 0,
  complaintsOpened: 0,
  complaintsResolved: 0,
  complaintsSlaBreached: 0,
  makeGoodsOpened: 0,
  makeGoodsCompleted: 0,
  makeGoodsOpenNow: 0
});

export async function getOperatorReports(
  fromDate: string,
  toDate: string
): Promise<OperatorReportsSnapshot> {
  if (!supabase) {
    return {
      fromDate,
      toDate,
      summary: {
        collectionsKobo: 0,
        payrollEstimateKobo: 0,
        fuelSpendKobo: 0,
        maintenanceSpendKobo: 0,
        tippingFeesKobo: 0,
        opsCostKobo: 0,
        netKobo: 0
      },
      lawmaSummary: emptyLawmaSummary(),
      collections: [],
      attendance: [],
      fleetCosts: [],
      wardCoverage: [],
      disposalTips: [],
      serviceComplaints: [],
      makeGoods: []
    };
  }

  const { data, error } = await supabase.rpc("operator_reports_snapshot", {
    input_from_date: fromDate,
    input_to_date: toDate
  });

  if (error) {
    throw new Error(error.message);
  }

  return operatorReportsSnapshotSchema.parse(data);
}

function csvEscape(value: string | number | boolean | null | undefined) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>
) {
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(","))
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
