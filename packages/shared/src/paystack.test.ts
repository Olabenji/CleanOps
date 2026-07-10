import { describe, expect, it } from "vitest";
import {
  computePaystackSignature,
  paystackChargeMetadataSchema,
  paystackChargeSuccessDataSchema,
  paystackIdempotencyKey,
  paystackWebhookEventSchema,
  verifyPaystackSignature
} from "./paystack";

describe("paystackIdempotencyKey", () => {
  it("prefixes the trimmed Paystack reference", () => {
    expect(paystackIdempotencyKey("  PSK_REF_001  ")).toBe("paystack:PSK_REF_001");
  });

  it("rejects empty references", () => {
    expect(() => paystackIdempotencyKey("   ")).toThrow("Paystack reference is required");
  });
});

describe("paystack webhook schemas", () => {
  const validMetadata = {
    operator_id: "00000000-0000-4000-8000-000000000001",
    customer_id: "00000000-0000-4000-8000-000000000401"
  };

  it("accepts charge.success metadata with operator and customer ids", () => {
    expect(paystackChargeMetadataSchema.parse(validMetadata)).toEqual(validMetadata);
  });

  it("rejects metadata missing customer_id", () => {
    expect(() =>
      paystackChargeMetadataSchema.parse({ operator_id: validMetadata.operator_id })
    ).toThrow();
  });

  it("accepts a full charge.success data payload", () => {
    const data = paystackChargeSuccessDataSchema.parse({
      amount: 500000,
      reference: "PSK_TEST_REF",
      paid_at: "2026-07-09T00:00:00.000Z",
      metadata: validMetadata
    });

    expect(data.amount).toBe(500000);
    expect(data.reference).toBe("PSK_TEST_REF");
  });

  it("accepts ignored events without charge data", () => {
    expect(paystackWebhookEventSchema.parse({ event: "transfer.success" })).toEqual({
      event: "transfer.success"
    });
  });
});

describe("Paystack signature verification", () => {
  const secret = "sk_test_cleanops_webhook";
  const rawBody = JSON.stringify({
    event: "charge.success",
    data: {
      amount: 500000,
      reference: "PSK_IDEMPOTENT_1",
      metadata: {
        operator_id: "00000000-0000-4000-8000-000000000001",
        customer_id: "00000000-0000-4000-8000-000000000401"
      }
    }
  });

  it("accepts a matching HMAC SHA-512 signature", async () => {
    const signature = await computePaystackSignature(secret, rawBody);
    await expect(verifyPaystackSignature(secret, rawBody, signature)).resolves.toBe(true);
  });

  it("rejects a tampered body", async () => {
    const signature = await computePaystackSignature(secret, rawBody);
    await expect(
      verifyPaystackSignature(secret, rawBody.replace("500000", "500001"), signature)
    ).resolves.toBe(false);
  });

  it("rejects a missing signature header", async () => {
    await expect(verifyPaystackSignature(secret, rawBody, null)).resolves.toBe(false);
  });

  it("is idempotent for the same reference key format", () => {
    const first = paystackIdempotencyKey("PSK_IDEMPOTENT_1");
    const second = paystackIdempotencyKey("PSK_IDEMPOTENT_1");
    expect(first).toBe(second);
    expect(first).toBe("paystack:PSK_IDEMPOTENT_1");
  });
});
