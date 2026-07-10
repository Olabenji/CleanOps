import { z } from "zod";

export const paystackChargeMetadataSchema = z.object({
  operator_id: z.string().uuid(),
  customer_id: z.string().uuid()
});

export const paystackChargeSuccessDataSchema = z.object({
  amount: z.number().int().positive(),
  reference: z.string().trim().min(1),
  paid_at: z.string().optional(),
  metadata: paystackChargeMetadataSchema
});

export const paystackWebhookEventSchema = z.object({
  event: z.string(),
  data: paystackChargeSuccessDataSchema.optional()
});

export type PaystackChargeMetadata = z.infer<typeof paystackChargeMetadataSchema>;
export type PaystackChargeSuccessData = z.infer<typeof paystackChargeSuccessDataSchema>;
export type PaystackWebhookEvent = z.infer<typeof paystackWebhookEventSchema>;

export function paystackIdempotencyKey(reference: string): string {
  const normalized = reference.trim();
  if (!normalized) {
    throw new Error("Paystack reference is required");
  }
  return `paystack:${normalized}`;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Compute Paystack x-paystack-signature (HMAC SHA-512 hex) for a raw body. */
export async function computePaystackSignature(
  secretKey: string,
  rawBody: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return bytesToHex(signature);
}

export async function verifyPaystackSignature(
  secretKey: string,
  rawBody: string,
  signatureHeader: string | null | undefined
): Promise<boolean> {
  if (!secretKey || !signatureHeader) {
    return false;
  }

  const expected = await computePaystackSignature(secretKey, rawBody);
  return expected === signatureHeader.toLowerCase();
}
