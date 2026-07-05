import type { FieldRole } from "../lib/fieldSession";
import {
  buildOfflineWorkspaceNotice,
  createPilotSession,
  pilotNames,
  type FieldSession
} from "../lib/fieldSession";
import { isUnreachableBackendError } from "../lib/networkErrors";
import { supabase, supabaseDisplayUrl } from "../lib/supabase";
import { withTimeout } from "../lib/withTimeout";

const SIGN_IN_TIMEOUT_MS = 12_000;
const RESTORE_TIMEOUT_MS = 4_000;

export type { FieldRole, FieldSession } from "../lib/fieldSession";

const credentials: Record<FieldRole, { email: string; password: string }> = {
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
  if (role === "driver" || role === "collection_agent") {
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

export async function signInFieldUser(role: FieldRole): Promise<FieldSession> {
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

    const { data: sessionData, error: sessionError } = await withTimeout(
      supabase.auth.getSession(),
      SIGN_IN_TIMEOUT_MS,
      "Timed out while loading session"
    );

    if (sessionError || !sessionData.session?.user.id) {
      if (sessionError && isUnreachableBackendError(sessionError)) {
        return offlineSession(role, sessionError);
      }

      throw new Error(sessionError?.message ?? "Signed in but session was not available");
    }

    const { data: profile, error: profileError } = await withTimeout(
      supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", sessionData.session.user.id)
        .maybeSingle(),
      SIGN_IN_TIMEOUT_MS,
      "Timed out while loading profile"
    );

    if (profileError) {
      if (isUnreachableBackendError(profileError)) {
        return offlineSession(role, profileError);
      }

      throw new Error(profileError.message);
    }

    const resolvedRole = toFieldRole(profile?.role ?? role);

    if (!resolvedRole) {
      throw new Error("Signed-in profile is not a field role");
    }

    return {
      fullName: profile?.full_name ?? pilotNames[resolvedRole],
      role: resolvedRole,
      mode: "supabase"
    };
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
        .select("full_name, role")
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
