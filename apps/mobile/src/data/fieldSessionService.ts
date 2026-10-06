import type { FieldRole } from "../lib/fieldSession";
import {
  buildOfflineWorkspaceNotice,
  createPilotSession,
  pilotNames,
  pilotPhones,
  type FieldSession
} from "../lib/fieldSession";
import { isUnreachableBackendError } from "../lib/networkErrors";
import { supabase, supabaseDisplayUrl } from "../lib/supabase";
import { withTimeout } from "../lib/withTimeout";

const SIGN_IN_TIMEOUT_MS = 12_000;
const RESTORE_TIMEOUT_MS = 4_000;

export type { FieldRole, FieldSession } from "../lib/fieldSession";

const credentials: Record<Exclude<FieldRole, "resident">, { email: string; password: string }> = {
  driver: {
    email: "driver@cleanops.local",
    password: "cleanops-driver-password"
  },
  collection_agent: {
    email: "agent@cleanops.local",
    password: "cleanops-agent-password"
  }
};

function toFieldRole(role: string): FieldRole | null {
  if (role === "driver" || role === "collection_agent" || role === "resident") {
    return role;
  }

  return null;
}

function forcePilotModeEnabled() {
  return process.env.EXPO_PUBLIC_FORCE_PILOT_MODE === "true";
}

function offlineSession(role: FieldRole, error: unknown): FieldSession {
  return createPilotSession(role, buildOfflineWorkspaceNotice(error, supabaseDisplayUrl));
}

async function loadFieldSessionFromAuth(fallbackRole: FieldRole): Promise<FieldSession> {
  if (!supabase) {
    return createPilotSession(fallbackRole);
  }

  const { data: sessionData, error: sessionError } = await withTimeout(
    supabase.auth.getSession(),
    SIGN_IN_TIMEOUT_MS,
    "Timed out while loading session"
  );

  if (sessionError || !sessionData.session?.user.id) {
    if (sessionError && isUnreachableBackendError(sessionError)) {
      return offlineSession(fallbackRole, sessionError);
    }

    throw new Error(sessionError?.message ?? "Signed in but session was not available");
  }

  const { data: profile, error: profileError } = await withTimeout(
    supabase.rpc("get_session_operator_context"),
    SIGN_IN_TIMEOUT_MS,
    "Timed out while loading profile"
  );

  if (profileError) {
    if (isUnreachableBackendError(profileError)) {
      return offlineSession(fallbackRole, profileError);
    }

    throw new Error(profileError.message);
  }

  const resolvedRole = toFieldRole(profile?.role ?? fallbackRole);

  if (!resolvedRole) {
    throw new Error(
      "This account is not authorized for the CleanOps mobile app. Use a driver, collection agent, or resident login."
    );
  }

  return {
    fullName: profile?.fullName ?? profile?.full_name ?? pilotNames[resolvedRole],
    phone: profile?.phone ?? pilotPhones[resolvedRole],
    role: resolvedRole,
    mode: "supabase",
    timezone: typeof profile?.timezone === "string" ? profile.timezone : "Africa/Lagos"
  };
}

export async function signInWithCredentials(email: string, password: string): Promise<FieldSession> {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail || !password) {
    throw new Error("Enter both email and password.");
  }

  if (!supabase || forcePilotModeEnabled()) {
    throw new Error("Email sign-in requires a live Supabase connection. Use demo accounts in offline mode.");
  }

  try {
    const { error } = await withTimeout(
      supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password
      }),
      SIGN_IN_TIMEOUT_MS,
      "Timed out while signing in"
    );

    if (error) {
      if (isUnreachableBackendError(error)) {
        throw new Error(`Cannot reach Supabase (${error.message}). Check Wi‑Fi and backend URL.`);
      }

      throw new Error(error.message);
    }

    return loadFieldSessionFromAuth("driver");
  } catch (error) {
    if (isUnreachableBackendError(error)) {
      throw new Error(error instanceof Error ? error.message : "Cannot reach Supabase.");
    }

    throw error;
  }
}

export type PhoneOtpRequestOutcome = {
  phoneE164: string;
  expiresAt?: string;
  message?: string;
  /** Present only when PHONE_OTP_DEV_REVEAL=true and Termii is unset. */
  devCode?: string;
};

function phoneOtpInvokeError(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string") {
    return (data as { error: string }).error;
  }
  return fallback;
}

/** Request SMS OTP for a provisioned field/resident login (Termii via phone-otp function). */
export async function requestPhoneOtp(phone: string): Promise<PhoneOtpRequestOutcome> {
  if (!supabase || forcePilotModeEnabled()) {
    throw new Error("Phone OTP requires a live Supabase connection.");
  }

  const trimmed = phone.trim();
  if (trimmed.length < 7) {
    throw new Error("Enter a valid Nigerian mobile number.");
  }

  try {
    const { data, error } = await withTimeout(
      supabase.functions.invoke("phone-otp", {
        body: { action: "request", phone: trimmed }
      }),
      SIGN_IN_TIMEOUT_MS,
      "Timed out while requesting OTP"
    );

    const payload = (data ?? {}) as {
      ok?: boolean;
      phoneE164?: string;
      expiresAt?: string;
      message?: string;
      error?: string;
      devCode?: string;
    };

    if ((!payload.ok && !payload.devCode) || error) {
      if (error && isUnreachableBackendError(error)) {
        throw new Error(`Cannot reach Supabase (${error.message}). Check Wi‑Fi and backend URL.`);
      }
      throw new Error(phoneOtpInvokeError(data, error?.message ?? "Unable to send OTP."));
    }

    return {
      phoneE164: payload.phoneE164 ?? trimmed,
      expiresAt: payload.expiresAt,
      message: payload.message,
      devCode: typeof payload.devCode === "string" ? payload.devCode : undefined
    };
  } catch (error) {
    if (isUnreachableBackendError(error)) {
      throw new Error(error instanceof Error ? error.message : "Cannot reach Supabase.");
    }
    throw error;
  }
}

/** Verify SMS OTP and restore a field session. */
export async function verifyPhoneOtp(phone: string, code: string): Promise<FieldSession> {
  if (!supabase || forcePilotModeEnabled()) {
    throw new Error("Phone OTP requires a live Supabase connection.");
  }

  const trimmedCode = code.trim();
  if (!/^\d{6}$/.test(trimmedCode)) {
    throw new Error("Enter the 6-digit code from SMS.");
  }

  try {
    const { data, error } = await withTimeout(
      supabase.functions.invoke("phone-otp", {
        body: { action: "verify", phone: phone.trim(), code: trimmedCode }
      }),
      SIGN_IN_TIMEOUT_MS,
      "Timed out while verifying OTP"
    );

    const payload = (data ?? {}) as { ok?: boolean; tokenHash?: string; error?: string };

    if (!payload.ok || !payload.tokenHash || error) {
      if (error && isUnreachableBackendError(error)) {
        throw new Error(`Cannot reach Supabase (${error.message}). Check Wi‑Fi and backend URL.`);
      }
      throw new Error(phoneOtpInvokeError(data, error?.message ?? "Unable to verify OTP."));
    }

    const { error: verifyError } = await withTimeout(
      supabase.auth.verifyOtp({
        token_hash: payload.tokenHash,
        type: "email"
      }),
      SIGN_IN_TIMEOUT_MS,
      "Timed out while completing phone sign-in"
    );

    if (verifyError) {
      throw new Error(verifyError.message);
    }

    return loadFieldSessionFromAuth("driver");
  } catch (error) {
    if (isUnreachableBackendError(error)) {
      throw new Error(error instanceof Error ? error.message : "Cannot reach Supabase.");
    }
    throw error;
  }
}

export async function signInFieldUser(role: FieldRole): Promise<FieldSession> {
  if (role === "resident") {
    if (!supabase || forcePilotModeEnabled()) {
      return createPilotSession("resident");
    }

    throw new Error("Resident demo sign-in requires a provisioned resident account. Use email/password.");
  }

  if (!supabase || forcePilotModeEnabled()) {
    return createPilotSession(role);
  }

  try {
    const { error } = await withTimeout(
      supabase.auth.signInWithPassword(credentials[role]),
      SIGN_IN_TIMEOUT_MS,
      "Timed out while signing in"
    );

    if (error) {
      if (isUnreachableBackendError(error)) {
        return offlineSession(role, error);
      }

      throw new Error(error.message);
    }

    return loadFieldSessionFromAuth(role);
  } catch (error) {
    if (isUnreachableBackendError(error)) {
      return offlineSession(role, error);
    }

    throw error;
  }
}

export async function restoreFieldSession(): Promise<FieldSession | null> {
  if (!supabase || forcePilotModeEnabled()) {
    return null;
  }

  try {
    const { data: sessionData } = await withTimeout(
      supabase.auth.getSession(),
      RESTORE_TIMEOUT_MS,
      "Timed out while restoring session"
    );

    if (!sessionData.session?.user.id) {
      return null;
    }

    const { data: profile, error } = await withTimeout(
      supabase
        .from("profiles")
        .select("full_name, phone, role")
        .eq("id", sessionData.session.user.id)
        .maybeSingle(),
      RESTORE_TIMEOUT_MS,
      "Timed out while loading profile"
    );

    if (error || !profile) {
      return null;
    }

    const role = toFieldRole(profile.role);

    if (!role) {
      return null;
    }

    return {
      fullName: profile.full_name,
      phone: profile.phone,
      role,
      mode: "supabase"
    };
  } catch {
    return null;
  }
}

export async function signOutFieldUser() {
  if (!supabase) {
    return;
  }

  try {
    await supabase.auth.signOut();
  } catch {
    // Ignore sign-out errors when the backend is offline.
  }
}
