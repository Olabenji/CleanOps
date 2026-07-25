import { describe, expect, it } from "vitest";
import {
  buildImportPreview,
  guessColumnMapping,
  monthlyRateToKobo,
  normalizeImportPhone,
  parseCustomerTypeCell,
  parseDelimitedTable,
  parsePreferredWeekdaysCell,
  previewRowsToImportRows
} from "./customerImport";

describe("customerImport parsers", () => {
  it("parses CSV and guesses column mapping", () => {
    const csv = [
      "display_name,phone,address,ward,customer_type,monthly_rate_ngn,collections_per_week,preferred_weekdays",
      "Ada Okoro,08031234567,12 Broad St,Ward A,residential,3500,1,Mon",
      "Bisi Foods,08039876543,5 Market Rd,B,restaurant,12000,3,\"1,3,5\""
    ].join("\n");

    const table = parseDelimitedTable(csv);
    expect(table.headers).toHaveLength(8);
    expect(table.rows).toHaveLength(2);

    const mapping = guessColumnMapping(table.headers);
    expect(mapping.display_name).toBe("displayName");
    expect(mapping.ward).toBe("wardName");
    expect(mapping.monthly_rate_ngn).toBe("monthlyRateNgn");

    const preview = buildImportPreview({ headers: table.headers, rows: table.rows, mapping });
    expect(preview.every((row) => row.valid)).toBe(true);
    expect(preview[0]?.monthlyRateKobo).toBe(350000);
    expect(preview[1]?.preferredWeekdays).toEqual([1, 3, 5]);

    const rows = previewRowsToImportRows(preview);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.frequencyNotes).toBe("bulk-import");
  });

  it("parses TSV weekdays and customer types", () => {
    expect(parsePreferredWeekdaysCell("Tue Wed Fri")).toEqual([2, 3, 5]);
    expect(parseCustomerTypeCell("Small Business")).toBe("small_business");
    expect(normalizeImportPhone("+234 803 123 4567")).toBe("+2348031234567");
    expect(monthlyRateToKobo({ monthlyRateNgn: "3,500.50" })).toBe(350050);
    expect(monthlyRateToKobo({ monthlyRateKobo: 350000 })).toBe(350000);
  });

  it("flags validation errors in preview", () => {
    const headers = ["name", "address", "ward", "type", "rate", "freq", "days"];
    const mapping = guessColumnMapping(headers);
    const preview = buildImportPreview({
      headers,
      rows: [["A", "x", "Ward A", "unknown", "-1", "0", "Mon"]],
      mapping
    });
    expect(preview[0]?.valid).toBe(false);
    expect(preview[0]?.errors.length).toBeGreaterThan(0);
  });
});
