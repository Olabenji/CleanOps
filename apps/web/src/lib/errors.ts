import { ZodError } from "zod";

export function formatAppError(error: unknown, fallback: string): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => issue.message).join(" ");
  }

  if (error instanceof Error && error.message && !error.message.startsWith("[")) {
    return error.message;
  }

  return fallback;
}

export function parseAmountNairaToKobo(amountNaira: string): number | null {
  const normalized = amountNaira.trim().replace(/,/g, "");
  if (!normalized) {
    return null;
  }

  const naira = Number(normalized);
  if (!Number.isFinite(naira) || naira <= 0) {
    return null;
  }

  return Math.round(naira * 100);
}
