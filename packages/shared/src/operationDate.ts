/**
 * Calendar helpers for CleanOps day-based workflows.
 *
 * "Today" follows the operator tenant timezone (set at onboarding).
 * Falls back to Africa/Lagos when no timezone is known yet.
 */

export const DEFAULT_OPERATION_TIME_ZONE = "Africa/Lagos";

/** Common IANA zones offered during operator onboarding. */
export const operationTimeZones = [
  "Africa/Lagos",
  "Africa/Accra",
  "Africa/Abidjan",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Africa/Cairo",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Australia/Sydney",
  "UTC"
] as const;

export type OperationTimeZone = (typeof operationTimeZones)[number] | string;

/** @deprecated Use DEFAULT_OPERATION_TIME_ZONE */
export const OPERATION_TIME_ZONE = DEFAULT_OPERATION_TIME_ZONE;

/** Today's date in a specific IANA timezone as YYYY-MM-DD. */
export function getZonedOperationDate(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || DEFAULT_OPERATION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(at);
}

/** Today's operation date as YYYY-MM-DD for the given tenant timezone. */
export function getOperationDate(
  timeZone: string = DEFAULT_OPERATION_TIME_ZONE,
  at: Date = new Date()
): string {
  return getZonedOperationDate(timeZone, at);
}

/** First day of the current operation month as YYYY-MM-DD. */
export function getOperationMonth(
  timeZone: string = DEFAULT_OPERATION_TIME_ZONE,
  at: Date = new Date()
): string {
  return `${getOperationDate(timeZone, at).slice(0, 7)}-01`;
}

/** Add calendar days to a YYYY-MM-DD date string. */
export function addOperationDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
