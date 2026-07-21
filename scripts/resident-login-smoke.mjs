#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.SUPABASE_URL ??
  process.env.API_URL ??
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  "http://127.0.0.1:54321";
const anonKey =
  process.env.SUPABASE_ANON_KEY ??
  process.env.ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  "";
const email = process.env.RESIDENT_SMOKE_EMAIL ?? "resident@cleanops.local";
const password =
  process.env.RESIDENT_SMOKE_PASSWORD ?? "cleanops-resident-password";

if (!anonKey) {
  throw new Error(
    "Set SUPABASE_ANON_KEY, ANON_KEY, or EXPO_PUBLIC_SUPABASE_ANON_KEY."
  );
}

const supabase = createClient(supabaseUrl, anonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const { data: signIn, error: signInError } =
  await supabase.auth.signInWithPassword({ email, password });

if (signInError || !signIn.user) {
  throw new Error(`Resident sign-in failed: ${signInError?.message ?? "no user"}`);
}

const { data: profile, error: profileError } = await supabase
  .from("profiles")
  .select("id, role, operator_id")
  .eq("id", signIn.user.id)
  .single();

if (profileError || profile?.role !== "resident") {
  throw new Error(
    `Resident profile check failed: ${profileError?.message ?? `role=${profile?.role}`}`
  );
}

const { data: home, error: homeError } = await supabase.rpc("get_resident_home");

if (homeError || !home?.customerId || !home?.psp?.operatorName) {
  throw new Error(
    `Resident home check failed: ${homeError?.message ?? "invalid payload"}`
  );
}

const { data: notifications, error: notificationsError } = await supabase.rpc(
  "list_my_resident_notifications",
  { input_limit: 5 }
);

if (notificationsError || !Array.isArray(notifications)) {
  throw new Error(
    `Resident inbox check failed: ${notificationsError?.message ?? "invalid payload"}`
  );
}

await supabase.auth.signOut();

console.log(
  JSON.stringify(
    {
      ok: true,
      userId: signIn.user.id,
      customerId: home.customerId,
      operatorName: home.psp.operatorName,
      notificationCount: notifications.length
    },
    null,
    2
  )
);
