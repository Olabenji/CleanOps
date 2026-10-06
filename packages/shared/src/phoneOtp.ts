import { z } from "zod";

/** Normalize Nigerian mobile numbers to E.164 (+234…). Mirrors SQL `normalize_ng_phone`. */
export function normalizeNgPhone(input: string | null | undefined): string | null {
  if (input == null) {
    return null;
  }

  const digits = String(input).replace(/[^0-9]/g, "");
  if (!digits) {
    return null;
  }

  let normalized = digits;
  if (normalized.startsWith("0") && normalized.length === 11) {
    normalized = `234${normalized.slice(1)}`;
  } else if (!normalized.startsWith("234") && normalized.length === 10) {
    normalized = `234${normalized}`;
  }

  if (!normalized.startsWith("234") || normalized.length < 12 || normalized.length > 14) {
    return null;
  }

  return `+${normalized}`;
}

export const phoneOtpRequestInputSchema = z.object({
  phone: z.string().min(7)
});

export const phoneOtpVerifyInputSchema = z.object({
  phone: z.string().min(7),
  code: z.string().regex(/^\d{6}$/)
});

export const phoneOtpRequestResultSchema = z.object({
  ok: z.boolean(),
  phoneE164: z.string().optional(),
  challengeId: z.string().uuid().optional(),
  expiresAt: z.string().optional(),
  termiiConfigured: z.boolean().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
  retryAfterSeconds: z.number().int().optional(),
  /** Only when PHONE_OTP_DEV_REVEAL=true and Termii is unset. */
  devCode: z.string().optional()
});

export const phoneOtpVerifyResultSchema = z.object({
  ok: z.boolean(),
  tokenHash: z.string().optional(),
  email: z.string().email().optional(),
  role: z.string().optional(),
  fullName: z.string().optional(),
  phoneE164: z.string().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
  attemptsRemaining: z.number().int().optional()
});

export type PhoneOtpRequestInput = z.infer<typeof phoneOtpRequestInputSchema>;
export type PhoneOtpVerifyInput = z.infer<typeof phoneOtpVerifyInputSchema>;
export type PhoneOtpRequestResult = z.infer<typeof phoneOtpRequestResultSchema>;
export type PhoneOtpVerifyResult = z.infer<typeof phoneOtpVerifyResultSchema>;
