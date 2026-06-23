import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("EXPO_PUBLIC_SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const payload = await request.json();
  const event = payload.event;
  const data = payload.data;

  if (event !== "charge.success") {
    return Response.json({ received: true, ignored: event });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const metadata = data.metadata ?? {};

  const { error } = await supabase.from("payments").insert({
    operator_id: metadata.operator_id,
    customer_id: metadata.customer_id,
    channel: "paystack",
    amount_kobo: data.amount,
    external_reference: data.reference,
    idempotency_key: `paystack:${data.reference}`,
    paid_at: data.paid_at ?? new Date().toISOString()
  });

  if (error && error.code !== "23505") {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ received: true });
});
