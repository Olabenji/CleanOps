import { supabase } from "../lib/supabase";

/** Never reveal whether the email is registered. */
export const PASSWORD_RESET_GENERIC_MESSAGE =
  "If an account exists for that email, a reset link has been sent. Check your inbox and spam folder. Open the link in a browser to set a new password, then return here to sign in.";

/**
 * Web app URL that completes password recovery (PasswordRecoveryScreen).
 * Prefer the machine LAN URL on physical devices, e.g. http://192.168.x.x:5173/
 */
export function getPasswordRecoveryRedirectUrl() {
  const configured = process.env.EXPO_PUBLIC_WEB_APP_URL?.trim().replace(/\/$/, "");
  if (configured) {
    return `${configured}/`;
  }

  return "http://localhost:5173/";
}

export async function requestPasswordReset(email: string): Promise<{ message: string }> {
  const normalized = email.trim().toLowerCase();

  if (!normalized || !normalized.includes("@")) {
    throw new Error("Enter a valid email address.");
  }

  if (!supabase) {
    throw new Error("Password reset requires a live Supabase connection.");
  }

  const { error } = await supabase.auth.resetPasswordForEmail(normalized, {
    redirectTo: getPasswordRecoveryRedirectUrl()
  });

  if (error && /rate limit|too many|email rate/i.test(error.message)) {
    throw new Error(error.message);
  }

  return { message: PASSWORD_RESET_GENERIC_MESSAGE };
}
