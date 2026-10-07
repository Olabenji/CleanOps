import { describe, expect, it } from "vitest";
import { normalizeNgPhone } from "./phoneOtp";

describe("normalizeNgPhone", () => {
  it("normalizes local 0-prefixed numbers", () => {
    expect(normalizeNgPhone("08031234567")).toBe("+2348031234567");
  });

  it("normalizes +234 and bare 234", () => {
    expect(normalizeNgPhone("+234 803 123 4567")).toBe("+2348031234567");
    expect(normalizeNgPhone("2348031234567")).toBe("+2348031234567");
  });

  it("normalizes 10-digit national without leading 0", () => {
    expect(normalizeNgPhone("8031234567")).toBe("+2348031234567");
  });

  it("rejects invalid values", () => {
    expect(normalizeNgPhone("")).toBeNull();
    expect(normalizeNgPhone("123")).toBeNull();
    expect(normalizeNgPhone("+15551234567")).toBeNull();
  });
});
