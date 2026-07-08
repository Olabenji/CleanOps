import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const siteUrl = Deno.env.get("SITE_URL") ?? "http://localhost:5173";

const allowedRoles = new Set(["operator_owner", "operations_supervisor"]);

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });

  const {
    data: { user },
    error: userError
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("operator_id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile?.operator_id || !allowedRoles.has(profile.role)) {
    return Response.json({ error: "Only operators can manage staff login access" }, { status: 403 });
  }

  const body = await request.json();
  const staffId = body.staffId as string | undefined;

  if (!staffId) {
    return Response.json({ error: "staffId is required" }, { status: 400 });
  }

  const { data: staffRow, error: staffError } = await userClient
    .from("staff_members")
    .select("id, login_email, profile_id, full_name")
    .eq("id", staffId)
    .maybeSingle();

  if (staffError || !staffRow) {
    return Response.json({ error: "Staff member not found" }, { status: 404 });
  }

  if (!staffRow.profile_id || !staffRow.login_email) {
    return Response.json({ error: "Staff member has no linked login profile" }, { status: 400 });
  }

  const recoverResponse = await fetch(`${supabaseUrl}/auth/v1/recover`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: staffRow.login_email,
      redirect_to: siteUrl
    })
  });

  if (!recoverResponse.ok) {
    const errorText = await recoverResponse.text();
    return Response.json(
      { error: errorText || "Unable to send password reset email" },
      { status: 500 }
    );
  }

  return Response.json({
    sent: true,
    loginEmail: staffRow.login_email,
    staffName: staffRow.full_name
  });
});
