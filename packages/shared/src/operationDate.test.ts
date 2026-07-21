import { describe, expect, it } from "vitest";
import {
  addOperationDays,
  DEFAULT_OPERATION_TIME_ZONE,
  getOperationDate,
  getOperationMonth,
  getZonedOperationDate
} from "./operationDate";

describe("operationDate", () => {
  it("defaults to Africa/Lagos", () => {
    expect(DEFAULT_OPERATION_TIME_ZONE).toBe("Africa/Lagos");
  });

  it("formats tenant timezone date independently of device offset", () => {
    // 2026-07-14 23:30 UTC → 2026-07-15 00:30 in Africa/Lagos
    expect(getZonedOperationDate("Africa/Lagos", new Date("2026-07-14T23:30:00.000Z"))).toBe(
      "2026-07-15"
    );
    // Same instant is still 14 Jul in America/New_York (UTC-4 in July)
    expect(getOperationDate("America/New_York", new Date("2026-07-14T23:30:00.000Z"))).toBe(
      "2026-07-14"
    );
  });

  it("returns the first of the tenant month", () => {
    expect(getOperationMonth("Africa/Lagos", new Date("2026-07-15T10:00:00.000Z"))).toBe("2026-07-01");
  });

  it("adds calendar days without UTC slice drift", () => {
    expect(addOperationDays("2026-07-14", 1)).toBe("2026-07-15");
    expect(addOperationDays("2026-07-31", 1)).toBe("2026-08-01");
  });
});
