import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { termiiSmsRequest } from "../../../packages/shared/src/residentComms.ts";

const supabaseUrl =
  Deno.env.get("SUPABASE_URL") ?? Deno.env.get("EXPO_PUBLIC_SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey =
  Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("EXPO_PUBLIC_SUPABASE_ANON_KEY") ?? "";

const termiiApiKey = Deno.env.get("TERMII_API_KEY") ?? "";
const termiiSenderId = Deno.env.get("TERMII_SENDER_ID") ?? "CleanOps";
const otpPepper = (Deno.env.get("PHONE_OTP_PEPPER") ?? "").trim();
const devRevealRequested =
  (Deno.env.get("PHONE_OTP_DEV_REVEAL") ?? "").toLowerCase() === "true";
const devReveal = devRevealRequested && !isHostedSupabaseProject(supabaseUrl);

if (devRevealRequested && isHostedSupabaseProject(supabaseUrl)) {
  console.warn(
    "phone-otp: PHONE_OTP_DEV_REVEAL is ignored because SUPABASE_URL points at a hosted *.supabase.co project."
  );
}

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_REQUESTS_PER_HOUR = 5;
const MAX_VERIFY_ATTEMPTS = 5;

type LookupResult = {
  ok: boolean;
  error?: string;
  phoneE164?: string;
  profileId?: string;
  role?: string;
  fullName?: string;
  email?: string;
};

function isHostedSupabaseProject(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "supabase.co" || hostname.endsWith(".supabase.co");
  } catch {
    return false;
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
    }
  });
}

function hasTermii() {
  return Boolean(termiiApiKey);
}

function generateOtpCode() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return value.toString().padStart(6, "0");
}

async function hashOtp(phoneE164: string, code: string) {
  if (!otpPepper) {
    throw new Error("PHONE_OTP_PEPPER is not configured.");
  }

  const material = `${phoneE164}:${code}:${otpPepper}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendTermiiSms(toE164: string, body: string) {
  // Sign-in OTP is user-initiated. It is not gated by WhatsApp/SMS notice consent.
  const request = termiiSmsRequest({
    baseUrl: Deno.env.get("TERMII_BASE_URL"),
    toE164,
    senderId: termiiSenderId,
    sms: body,
    apiKey: termiiApiKey
  });
  const response = await fetch(request.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request.body)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.code === "error") {
    throw new Error(
      typeof payload?.message === "string"
        ? payload.message
        : `Termii SMS failed (${response.status})`
    );
  }

  return typeof payload?.message_id === "string"
    ? payload.message_id
    : typeof payload?.messageId === "string"
      ? payload.messageId
      : null;
}

async function writeAudit(
  admin: ReturnType<typeof createClient>,
  input: {
    phoneE164?: string | null;
    profileId?: string | null;
    event: string;
    detail?: string | null;
  }
) {
  await admin.from("phone_otp_audit").insert({
    phone_e164: input.phoneE164 ?? null,
    profile_id: input.profileId ?? null,
    event: input.event,
    detail: input.detail ?? null
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return jsonResponse({ ok: true });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Server misconfigured (Supabase URL / service role)." }, 500);
  }

  if (!otpPepper) {
    return jsonResponse(
      {
        ok: false,
        error:
          "PHONE_OTP_PEPPER is not configured. Set it in the phone-otp function secrets."
      },
      500
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const action = typeof body.action === "string" ? body.action : "";

  if (action === "request") {
    return await handleRequest(admin, body);
  }

  if (action === "verify") {
    return await handleVerify(admin, body);
  }

  return jsonResponse({ error: "Unknown action. Use request or verify." }, 400);
});

async function handleRequest(admin: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const phone = typeof body.phone === "string" ? body.phone : "";
  if (!phone.trim()) {
    return jsonResponse({ ok: false, error: "Enter a Nigerian mobile number." }, 400);
  }

  const { data: lookupRaw, error: lookupError } = await admin.rpc("lookup_profile_for_phone_otp", {
    input_phone: phone
  });

  if (lookupError) {
    return jsonResponse({ ok: false, error: lookupError.message }, 500);
  }

  const lookup = (lookupRaw ?? {}) as LookupResult;

  if (!lookup.ok) {
    const message =
      lookup.error === "invalid_phone"
        ? "Enter a valid Nigerian mobile number (e.g. 0803… or +234…)."
        : lookup.error === "ambiguous"
          ? "Multiple accounts share this phone. Ask your operator to fix the duplicate."
          : lookup.error === "no_login"
            ? "This phone has a profile but no login. Ask your operator to provision access."
            : "No CleanOps login is linked to this phone. Ask your operator to provision access.";

    await writeAudit(admin, {
      phoneE164: lookup.phoneE164 ?? null,
      event: "request_rejected",
      detail: lookup.error ?? "not_found"
    });

    return jsonResponse({ ok: false, error: message, code: lookup.error ?? "not_found" }, 400);
  }

  const phoneE164 = lookup.phoneE164!;
  const profileId = lookup.profileId!;

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recentRows, error: recentError } = await admin
    .from("phone_otp_challenges")
    .select("id, created_at")
    .eq("phone_e164", phoneE164)
    .gte("created_at", hourAgo)
    .order("created_at", { ascending: false });

  if (recentError) {
    return jsonResponse({ ok: false, error: recentError.message }, 500);
  }

  const recent = recentRows ?? [];
  if (recent.length >= MAX_REQUESTS_PER_HOUR) {
    await writeAudit(admin, {
      phoneE164,
      profileId,
      event: "rate_limited",
      detail: "hourly_cap"
    });
    return jsonResponse(
      {
        ok: false,
        error: "Too many OTP requests for this number. Try again in about an hour.",
        code: "rate_limited"
      },
      429
    );
  }

  const latest = recent[0];
  if (latest?.created_at) {
    const ageMs = Date.now() - new Date(latest.created_at).getTime();
    if (ageMs < RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil((RESEND_COOLDOWN_MS - ageMs) / 1000);
      await writeAudit(admin, {
        phoneE164,
        profileId,
        event: "rate_limited",
        detail: `cooldown_${waitSec}s`
      });
      return jsonResponse(
        {
          ok: false,
          error: `Wait ${waitSec}s before requesting another code.`,
          code: "cooldown",
          retryAfterSeconds: waitSec
        },
        429
      );
    }
  }

  const code = generateOtpCode();
  const codeHash = await hashOtp(phoneE164, code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  const { data: challenge, error: insertError } = await admin
    .from("phone_otp_challenges")
    .insert({
      phone_e164: phoneE164,
      profile_id: profileId,
      code_hash: codeHash,
      expires_at: expiresAt,
      max_attempts: MAX_VERIFY_ATTEMPTS
    })
    .select("id, expires_at")
    .single();

  if (insertError || !challenge) {
    return jsonResponse(
      { ok: false, error: insertError?.message ?? "Unable to create OTP challenge." },
      500
    );
  }

  await writeAudit(admin, {
    phoneE164,
    profileId,
    event: "request_accepted",
    detail: challenge.id
  });

  const smsBody = `CleanOps code: ${code}. Expires in 10 minutes. Do not share this code.`;

  if (!hasTermii()) {
    await writeAudit(admin, {
      phoneE164,
      profileId,
      event: "sms_not_configured",
      detail: "TERMII_API_KEY missing"
    });

    const payload: Record<string, unknown> = {
      ok: false,
      code: "sms_not_configured",
      error:
        "SMS delivery is not configured. Set TERMII_API_KEY (and optional TERMII_SENDER_ID) on the phone-otp function secrets, then retry.",
      phoneE164,
      challengeId: challenge.id,
      expiresAt: challenge.expires_at,
      termiiConfigured: false
    };

    if (devReveal) {
      payload.devCode = code;
      payload.message =
        "Dev reveal enabled (PHONE_OTP_DEV_REVEAL=true). Use the returned code to verify without SMS.";
      payload.ok = true;
    }

    return jsonResponse(payload, devReveal ? 200 : 503);
  }

  try {
    const ticketId = await sendTermiiSms(phoneE164, smsBody);
    await writeAudit(admin, {
      phoneE164,
      profileId,
      event: "sms_sent",
      detail: ticketId
    });

    return jsonResponse({
      ok: true,
      phoneE164,
      challengeId: challenge.id,
      expiresAt: challenge.expires_at,
      termiiConfigured: true,
      message: "If this number has a CleanOps login, a one-time code was sent by SMS."
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Termii send failed";
    await writeAudit(admin, {
      phoneE164,
      profileId,
      event: "sms_failed",
      detail
    });

    return jsonResponse(
      {
        ok: false,
        code: "sms_failed",
        error: `Unable to send SMS: ${detail}`,
        phoneE164,
        challengeId: challenge.id,
        termiiConfigured: true
      },
      502
    );
  }
}

async function handleVerify(admin: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const phone = typeof body.phone === "string" ? body.phone : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!phone.trim() || !/^\d{6}$/.test(code)) {
    return jsonResponse(
      { ok: false, error: "Enter the phone number and the 6-digit code." },
      400
    );
  }

  const { data: lookupRaw, error: lookupError } = await admin.rpc("lookup_profile_for_phone_otp", {
    input_phone: phone
  });

  if (lookupError) {
    return jsonResponse({ ok: false, error: lookupError.message }, 500);
  }

  const lookup = (lookupRaw ?? {}) as LookupResult;
  if (!lookup.ok || !lookup.phoneE164 || !lookup.profileId || !lookup.email) {
    await writeAudit(admin, {
      phoneE164: lookup.phoneE164 ?? null,
      event: "verify_failed",
      detail: lookup.error ?? "not_found"
    });
    return jsonResponse(
      { ok: false, error: "Invalid phone or code.", code: "invalid" },
      400
    );
  }

  const phoneE164 = lookup.phoneE164;

  const { data: challenge, error: challengeError } = await admin
    .from("phone_otp_challenges")
    .select("id, code_hash, expires_at, attempt_count, max_attempts, consumed_at")
    .eq("phone_e164", phoneE164)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (challengeError) {
    return jsonResponse({ ok: false, error: challengeError.message }, 500);
  }

  if (!challenge) {
    await writeAudit(admin, {
      phoneE164,
      profileId: lookup.profileId,
      event: "verify_failed",
      detail: "no_challenge"
    });
    return jsonResponse(
      { ok: false, error: "No active code for this number. Request a new OTP.", code: "expired" },
      400
    );
  }

  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    await writeAudit(admin, {
      phoneE164,
      profileId: lookup.profileId,
      event: "verify_failed",
      detail: "expired"
    });
    return jsonResponse(
      { ok: false, error: "That code has expired. Request a new OTP.", code: "expired" },
      400
    );
  }

  if (challenge.attempt_count >= challenge.max_attempts) {
    await writeAudit(admin, {
      phoneE164,
      profileId: lookup.profileId,
      event: "verify_failed",
      detail: "max_attempts"
    });
    return jsonResponse(
      {
        ok: false,
        error: "Too many incorrect attempts. Request a new OTP.",
        code: "max_attempts"
      },
      429
    );
  }

  const expectedHash = await hashOtp(phoneE164, code);
  if (expectedHash !== challenge.code_hash) {
    const nextAttempts = challenge.attempt_count + 1;
    await admin
      .from("phone_otp_challenges")
      .update({
        attempt_count: nextAttempts,
        last_error: "bad_code"
      })
      .eq("id", challenge.id);

    await writeAudit(admin, {
      phoneE164,
      profileId: lookup.profileId,
      event: "verify_failed",
      detail: `bad_code_${nextAttempts}`
    });

    return jsonResponse(
      {
        ok: false,
        error: "Incorrect code. Check the SMS and try again.",
        code: "invalid",
        attemptsRemaining: Math.max(challenge.max_attempts - nextAttempts, 0)
      },
      400
    );
  }

  await admin
    .from("phone_otp_challenges")
    .update({
      consumed_at: new Date().toISOString(),
      attempt_count: challenge.attempt_count + 1
    })
    .eq("id", challenge.id);

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: lookup.email
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    await writeAudit(admin, {
      phoneE164,
      profileId: lookup.profileId,
      event: "verify_failed",
      detail: linkError?.message ?? "generate_link_failed"
    });
    return jsonResponse(
      {
        ok: false,
        error: linkError?.message ?? "Unable to create a signed-in session from OTP."
      },
      500
    );
  }

  // Best-effort: mark Auth phone as confirmed for this login.
  try {
    await admin.auth.admin.updateUserById(lookup.profileId, {
      phone: phoneE164,
      phone_confirm: true
    });
  } catch {
    // ignore — session still works via email magic link token
  }

  await writeAudit(admin, {
    phoneE164,
    profileId: lookup.profileId,
    event: "verify_ok",
    detail: challenge.id
  });

  return jsonResponse({
    ok: true,
    tokenHash: linkData.properties.hashed_token,
    email: lookup.email,
    role: lookup.role,
    fullName: lookup.fullName,
    phoneE164,
    // anonKey is unused for session; clients call verifyOtp with tokenHash
    message: "Phone verified. Completing sign-in…"
  });
}

// Keep anonKey referenced so local serve env validation stays obvious in logs when missing.
if (!anonKey) {
  console.warn("phone-otp: SUPABASE_ANON_KEY not set (not required for request/verify).");
}
