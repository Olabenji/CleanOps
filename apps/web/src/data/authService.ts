import { operatorProfileSchema, type OperatorProfile } from "@cleanops/shared";
import { supabase } from "../lib/supabase";
import { demoCredentials, pilotProfile } from "./pilotWorkflows";

export type AuthState = {
  profile: OperatorProfile;
  mode: "demo" | "supabase";
};

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

async function loadProfile(userId: string): Promise<AuthState> {
  if (!supabase) {
    return {
      profile: pilotProfile,
      mode: "demo"
    };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, operator_id, role, full_name, phone, operators(name)")
    .eq("id", userId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Profile not found");
  }

  const operator = Array.isArray(data.operators) ? data.operators[0] : data.operators;
  const parsed = operatorProfileSchema.parse({
    id: data.id,
    operatorId: data.operator_id,
    operatorName: operator?.name ?? null,
    fullName: data.full_name,
    phone: data.phone,
    role: data.role
  });

  return {
    profile: parsed,
    mode: "supabase"
  };
}
