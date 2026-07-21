import { operatorProfileSchema, type OperatorProfile } from "@cleanops/shared";
import { supabase } from "../lib/supabase";
import { demoCredentials, pilotProfile } from "./pilotWorkflows";

export type AuthState = {
  profile: OperatorProfile;
  mode: "demo" | "supabase";
};

/** Shared copy — never reveal whether the email is registered. */
export const PASSWORD_RESET_GENERIC_MESSAGE =
  "If an account exists for that email, a reset link has been sent. Check your inbox and spam folder. Open the link to set a new password, then sign in again (operators on this site; field staff on the mobile app).";

export function getPasswordRecoveryRedirectUrl() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return `${window.location.origin}${window.location.pathname}`;
}

/**
 * Self-serve forgot-password for any Auth login (platform, operator, staff, future resident).
 * Always returns the same success message to avoid account enumeration.
 */
export async function requestPasswordReset(
  email: string,
  redirectTo = getPasswordRecoveryRedirectUrl()
): Promise<{ message: string }> {
  const normalized = email.trim().toLowerCase();

  if (!normalized || !normalized.includes("@")) {
    throw new Error("Enter a valid email address.");
  }

  if (!supabase) {
    throw new Error("Password reset requires a live Supabase connection.");
  }

  const { error } = await supabase.auth.resetPasswordForEmail(normalized, {
    ...(redirectTo ? { redirectTo } : {})
  });

  if (error && /rate limit|too many|email rate/i.test(error.message)) {
    throw new Error(error.message);
  }

  return { message: PASSWORD_RESET_GENERIC_MESSAGE };
}

export async function getCurrentOperatorProfile(): Promise<AuthState | null> {
  if (!supabase) {
    return {
      profile: pilotProfile,
      mode: "demo"
    };
  }

  const { data: sessionData } = await supabase.auth.getSession();

  if (!sessionData.session) {
    return null;
  }

  return loadProfile(sessionData.session.user.id);
}

export async function signInOperator(email = demoCredentials.email, password = demoCredentials.password) {
  if (!supabase) {
    return {
      profile: pilotProfile,
      mode: "demo" as const
    };
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    throw new Error(error?.message ?? "Unable to sign in");
  }

  return loadProfile(data.user.id);
}

export async function signOutOperator() {
  if (!supabase) {
    return;
  }

  await supabase.auth.signOut();
}

const RECOVERY_PENDING_KEY = "cleanops_password_recovery_pending";

export function markPasswordRecoveryPending() {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(RECOVERY_PENDING_KEY, "1");
  }
}

export function isPasswordRecoveryPending() {
  if (typeof window === "undefined") {
    return false;
  }

  return sessionStorage.getItem(RECOVERY_PENDING_KEY) === "1";
}

export function clearPasswordRecoveryPending() {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(RECOVERY_PENDING_KEY);
  }
}

export function isPasswordRecoveryLanding(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (hashParams.get("type") === "recovery") {
    return true;
  }

  const queryParams = new URLSearchParams(window.location.search);
  return queryParams.get("type") === "recovery";
}

export function clearPasswordRecoveryUrl() {
  if (typeof window === "undefined") {
    return;
  }

  const cleanUrl = `${window.location.origin}${window.location.pathname}`;
  window.history.replaceState({}, document.title, cleanUrl);
}

export async function completePasswordRecovery(newPassword: string): Promise<string> {
  if (!supabase) {
    throw new Error("Password recovery requires Supabase.");
  }

  if (newPassword.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const { data, error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) {
    throw new Error(error.message);
  }

  const nextEmail = data.user?.email;
  if (!nextEmail) {
    throw new Error("Unable to confirm account after password update.");
  }

  clearPasswordRecoveryUrl();
  clearPasswordRecoveryPending();
  await supabase.auth.signOut();

  return nextEmail;
}

export function subscribeToPasswordRecovery(onRecovery: (email: string) => void) {
  if (!supabase) {
    return () => {};
  }

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" && session?.user.email) {
      markPasswordRecoveryPending();
      onRecovery(session.user.email);
    }
  });

  return () => {
    data.subscription.unsubscribe();
  };
}

export async function resolvePasswordRecoveryEmail(): Promise<string | null> {
  if (!supabase) {
    return null;
  }

  if (isPasswordRecoveryLanding()) {
    markPasswordRecoveryPending();
  }

  if (!isPasswordRecoveryPending() && !isPasswordRecoveryLanding()) {
    return null;
  }

  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session?.user.email) {
    return null;
  }

  return data.session.user.email;
}

export async function getPasswordRecoveryContext(): Promise<string | null> {
  return resolvePasswordRecoveryEmail();
}

async function loadProfile(userId: string): Promise<AuthState> {
  if (!supabase) {
    return {
      profile: pilotProfile,
      mode: "demo"
    };
  }

  const { data, error } = await supabase.rpc("get_session_operator_context");

  if (error || !data) {
    throw new Error(error?.message ?? "Profile not found");
  }

  const parsed = operatorProfileSchema.parse(data);

  if (parsed.id !== userId) {
    throw new Error("Session profile mismatch");
  }

  return {
    profile: parsed,
    mode: "supabase"
  };
}
