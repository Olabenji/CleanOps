type ReminderRequest = {
  operatorId: string;
  daysBeforeDue: 2 | 5;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = (await request.json()) as ReminderRequest;

  // The first production pass will load due residents, choose WhatsApp or SMS,
  // and record notification attempts for audit/retry.
  return Response.json({
    queued: true,
    operatorId: body.operatorId,
    daysBeforeDue: body.daysBeforeDue
  });
});
