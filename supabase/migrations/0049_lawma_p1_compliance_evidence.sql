-- LAWMA P1: disposal dockets/tonnage, service complaints (24h SLA),
-- bill deliveries, compliance cases, vehicle branding/PPE checklists.

-- ---------------------------------------------------------------------------
-- (a) Extend dumpsite_runs with disposal evidence
-- ---------------------------------------------------------------------------
alter table public.dumpsite_runs
  add column if not exists dumpsite_site_name text,
  add column if not exists docket_number text,
  add column if not exists weighbridge_tonnes numeric(10, 3),
  add column if not exists ticket_photo_path text;

comment on column public.dumpsite_runs.docket_number is
  'Disposal receipt / docket number collected at the landfill weighbridge.';
comment on column public.dumpsite_runs.weighbridge_tonnes is
  'Gross or net tonnes from weighbridge ticket (SOP: daily weighing).';

create or replace function public.driver_dumpsite_run_for_route(input_route_id uuid)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  driver_staff_id uuid;
  run_row public.dumpsite_runs%rowtype;
begin
  select id
  into driver_staff_id
  from public.staff_members
  where profile_id = auth.uid()
    and operator_id = public.current_operator_id()
    and role = 'driver'
    and active
  limit 1;

  if driver_staff_id is null then
    raise exception 'Only active drivers can view dumpsite runs';
  end if;

  if not exists (
    select 1
    from public.routes
    where routes.id = input_route_id
      and routes.operator_id = public.current_operator_id()
      and routes.driver_id = driver_staff_id
  ) then
    raise exception 'Assigned route not found';
  end if;

  select *
  into run_row
  from public.dumpsite_runs
  where route_id = input_route_id
    and operator_id = public.current_operator_id()
  order by coalesce(cleared_at, arrived_at, departed_at, now()) desc
  limit 1;

  if run_row.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', run_row.id,
    'routeId', run_row.route_id,
    'departedAt', run_row.departed_at,
    'arrivedAt', run_row.arrived_at,
    'clearedAt', run_row.cleared_at,
    'tippingFeeKobo', run_row.tipping_fee_kobo,
    'notes', run_row.notes,
    'dumpsiteSiteName', run_row.dumpsite_site_name,
    'docketNumber', run_row.docket_number,
    'weighbridgeTonnes', run_row.weighbridge_tonnes,
    'ticketPhotoPath', run_row.ticket_photo_path
  );
end;
$$;

drop function if exists public.record_dumpsite_run(uuid, text, integer, text);

create or replace function public.record_dumpsite_run(
  input_route_id uuid,
  input_phase text,
  input_tipping_fee_kobo integer default null,
  input_notes text default null,
  input_dumpsite_site_name text default null,
  input_docket_number text default null,
  input_weighbridge_tonnes numeric default null,
  input_ticket_photo_path text default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  driver_staff_id uuid;
  route_record public.routes%rowtype;
  run_row public.dumpsite_runs%rowtype;
  phase text := lower(trim(input_phase));
  event_time timestamptz := now();
begin
  select id
  into driver_staff_id
  from public.staff_members
  where profile_id = auth.uid()
    and operator_id = public.current_operator_id()
    and role = 'driver'
    and active
  limit 1;

  if driver_staff_id is null then
    raise exception 'Only active drivers can record dumpsite runs';
  end if;

  if phase not in ('depart', 'arrive', 'clear') then
    raise exception 'Dumpsite phase must be depart, arrive, or clear';
  end if;

  select *
  into route_record
  from public.routes
  where id = input_route_id
    and operator_id = public.current_operator_id()
    and driver_id = driver_staff_id;

  if route_record.id is null then
    raise exception 'Assigned route not found';
  end if;

  select *
  into run_row
  from public.dumpsite_runs
  where route_id = input_route_id
    and operator_id = public.current_operator_id()
    and cleared_at is null
  order by coalesce(departed_at, arrived_at, event_time) desc
  limit 1;

  if phase = 'depart' then
    if run_row.id is not null and run_row.departed_at is not null then
      raise exception 'Dumpsite run already departed for this route';
    end if;

    insert into public.dumpsite_runs (
      operator_id,
      route_id,
      departed_at,
      tipping_fee_kobo,
      notes,
      dumpsite_site_name
    )
    values (
      route_record.operator_id,
      route_record.id,
      event_time,
      0,
      nullif(trim(coalesce(input_notes, '')), ''),
      nullif(trim(coalesce(input_dumpsite_site_name, '')), '')
    )
    returning * into run_row;
  elsif phase = 'arrive' then
    if run_row.id is null or run_row.departed_at is null then
      raise exception 'Depart for dumpsite before recording arrival';
    end if;

    if run_row.arrived_at is not null then
      raise exception 'Dumpsite arrival already recorded';
    end if;

    update public.dumpsite_runs
    set
      arrived_at = event_time,
      notes = coalesce(nullif(trim(coalesce(input_notes, '')), ''), notes),
      dumpsite_site_name = coalesce(
        nullif(trim(coalesce(input_dumpsite_site_name, '')), ''),
        dumpsite_site_name
      )
    where id = run_row.id
    returning * into run_row;
  else
    if run_row.id is null or run_row.arrived_at is null then
      raise exception 'Arrive at dumpsite before recording clearance';
    end if;

    if run_row.cleared_at is not null then
      raise exception 'Dumpsite clearance already recorded';
    end if;

    update public.dumpsite_runs
    set
      cleared_at = event_time,
      tipping_fee_kobo = coalesce(input_tipping_fee_kobo, tipping_fee_kobo, 0),
      notes = coalesce(nullif(trim(coalesce(input_notes, '')), ''), notes),
      dumpsite_site_name = coalesce(
        nullif(trim(coalesce(input_dumpsite_site_name, '')), ''),
        dumpsite_site_name
      ),
      docket_number = coalesce(
        nullif(trim(coalesce(input_docket_number, '')), ''),
        docket_number
      ),
      weighbridge_tonnes = coalesce(input_weighbridge_tonnes, weighbridge_tonnes),
      ticket_photo_path = coalesce(
        nullif(trim(coalesce(input_ticket_photo_path, '')), ''),
        ticket_photo_path
      )
    where id = run_row.id
    returning * into run_row;
  end if;

  return jsonb_build_object(
    'id', run_row.id,
    'routeId', run_row.route_id,
    'departedAt', run_row.departed_at,
    'arrivedAt', run_row.arrived_at,
    'clearedAt', run_row.cleared_at,
    'tippingFeeKobo', run_row.tipping_fee_kobo,
    'notes', run_row.notes,
    'dumpsiteSiteName', run_row.dumpsite_site_name,
    'docketNumber', run_row.docket_number,
    'weighbridgeTonnes', run_row.weighbridge_tonnes,
    'ticketPhotoPath', run_row.ticket_photo_path
  );
end;
$$;

grant execute on function public.record_dumpsite_run(uuid, text, integer, text, text, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- (b) Service complaints — 24h SLA
-- ---------------------------------------------------------------------------
create table if not exists public.service_complaints (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  route_id uuid references public.routes(id) on delete set null,
  zone_id uuid references public.zones(id) on delete set null,
  source text not null default 'operator'
    check (source in ('operator', 'resident', 'agent', 'call_centre')),
  category text not null default 'other'
    check (category in ('missed_stop', 'overflow', 'crew', 'billing', 'illegal_dump', 'other')),
  title text not null,
  description text not null,
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'in_progress', 'resolved', 'escalated')),
  reported_by_staff_id uuid references public.staff_members(id) on delete set null,
  assigned_to_staff_id uuid references public.staff_members(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  escalated_at timestamptz,
  sla_due_at timestamptz not null default (now() + interval '24 hours'),
  resolution_notes text,
  created_at timestamptz not null default now()
);

create index if not exists service_complaints_operator_status_idx
  on public.service_complaints (operator_id, status, sla_due_at);

alter table public.service_complaints enable row level security;

create policy "tenant read service complaints"
  on public.service_complaints for select
  using (operator_id = public.current_operator_id());

create policy "managers write service complaints"
  on public.service_complaints for all
  using (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'collection_agent')
  )
  with check (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'collection_agent')
  );

create or replace function public.list_service_complaints(input_date date default current_date)
returns jsonb
language sql
stable
security invoker
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'customerId', c.customer_id,
        'customerName', customers.display_name,
        'routeId', c.route_id,
        'zoneName', zones.name,
        'source', c.source,
        'category', c.category,
        'title', c.title,
        'description', c.description,
        'status', c.status,
        'acknowledgedAt', c.acknowledged_at,
        'resolvedAt', c.resolved_at,
        'escalatedAt', c.escalated_at,
        'slaDueAt', c.sla_due_at,
        'resolutionNotes', c.resolution_notes,
        'createdAt', c.created_at,
        'slaBreached',
          c.resolved_at is null
          and c.sla_due_at < now()
      )
      order by
        case when c.resolved_at is null and c.sla_due_at < now() then 0 else 1 end,
        c.created_at desc
    ),
    '[]'::jsonb
  )
  from public.service_complaints c
  left join public.customers on customers.id = c.customer_id
  left join public.zones on zones.id = c.zone_id
  where c.operator_id = public.current_operator_id()
    and c.created_at::date <= coalesce(input_date, current_date);
$$;

create or replace function public.create_service_complaint(
  input_title text,
  input_description text,
  input_category text default 'other',
  input_source text default 'operator',
  input_customer_id uuid default null,
  input_route_id uuid default null,
  input_zone_id uuid default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  tenant_id uuid := public.current_operator_id();
  staff_id uuid;
  new_id uuid;
  category text := lower(trim(coalesce(input_category, 'other')));
  source text := lower(trim(coalesce(input_source, 'operator')));
begin
  if tenant_id is null then
    raise exception 'Not authenticated';
  end if;

  if public.current_app_role() not in ('operator_owner', 'operations_supervisor', 'collection_agent') then
    raise exception 'Not allowed to create complaints';
  end if;

  if category not in ('missed_stop', 'overflow', 'crew', 'billing', 'illegal_dump', 'other') then
    raise exception 'Invalid complaint category';
  end if;

  if source not in ('operator', 'resident', 'agent', 'call_centre') then
    raise exception 'Invalid complaint source';
  end if;

  select id into staff_id
  from public.staff_members
  where profile_id = auth.uid()
    and operator_id = tenant_id
  limit 1;

  insert into public.service_complaints (
    operator_id,
    customer_id,
    route_id,
    zone_id,
    source,
    category,
    title,
    description,
    reported_by_staff_id,
    sla_due_at
  )
  values (
    tenant_id,
    input_customer_id,
    input_route_id,
    input_zone_id,
    source,
    category,
    trim(input_title),
    trim(input_description),
    staff_id,
    now() + interval '24 hours'
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.update_service_complaint_status(
  input_complaint_id uuid,
  next_status text,
  input_resolution_notes text default null
)
returns void
language plpgsql
security invoker
as $$
declare
  tenant_id uuid := public.current_operator_id();
  status_value text := lower(trim(next_status));
begin
  if public.current_app_role() not in ('operator_owner', 'operations_supervisor') then
    raise exception 'Not allowed to update complaint status';
  end if;

  if status_value not in ('open', 'acknowledged', 'in_progress', 'resolved', 'escalated') then
    raise exception 'Invalid complaint status';
  end if;

  update public.service_complaints
  set
    status = status_value,
    acknowledged_at = case
      when status_value = 'acknowledged' then coalesce(acknowledged_at, now())
      else acknowledged_at
    end,
    escalated_at = case
      when status_value = 'escalated' then coalesce(escalated_at, now())
      else escalated_at
    end,
    resolved_at = case
      when status_value = 'resolved' then coalesce(resolved_at, now())
      when status_value <> 'resolved' then null
      else resolved_at
    end,
    resolution_notes = case
      when input_resolution_notes is null then resolution_notes
      else nullif(trim(input_resolution_notes), '')
    end
  where id = input_complaint_id
    and operator_id = tenant_id;

  if not found then
    raise exception 'Complaint not found';
  end if;
end;
$$;

grant execute on function public.list_service_complaints(date) to authenticated;
grant execute on function public.create_service_complaint(text, text, text, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.update_service_complaint_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- (c) Bill deliveries
-- ---------------------------------------------------------------------------
create table if not exists public.bill_deliveries (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  bill_period_start date not null,
  amount_kobo integer not null check (amount_kobo >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'delivered', 'failed', 'disputed')),
  delivered_by_staff_id uuid references public.staff_members(id) on delete set null,
  delivered_at timestamptz,
  delivery_note text,
  created_at timestamptz not null default now(),
  unique (operator_id, customer_id, bill_period_start)
);

create index if not exists bill_deliveries_operator_period_idx
  on public.bill_deliveries (operator_id, bill_period_start, status);

alter table public.bill_deliveries enable row level security;

create policy "tenant read bill deliveries"
  on public.bill_deliveries for select
  using (operator_id = public.current_operator_id());

create policy "staff write bill deliveries"
  on public.bill_deliveries for all
  using (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'collection_agent')
  )
  with check (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'collection_agent')
  );

create or replace function public.list_bill_deliveries(input_period_start date default null)
returns jsonb
language sql
stable
security invoker
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'customerId', b.customer_id,
        'customerName', customers.display_name,
        'zoneName', zones.name,
        'billPeriodStart', b.bill_period_start,
        'amountKobo', b.amount_kobo,
        'status', b.status,
        'deliveredAt', b.delivered_at,
        'deliveryNote', b.delivery_note,
        'deliveredByName', staff_members.full_name,
        'createdAt', b.created_at
      )
      order by b.bill_period_start desc, customers.display_name
    ),
    '[]'::jsonb
  )
  from public.bill_deliveries b
  join public.customers on customers.id = b.customer_id
  left join public.zones on zones.id = customers.zone_id
  left join public.staff_members on staff_members.id = b.delivered_by_staff_id
  where b.operator_id = public.current_operator_id()
    and (
      input_period_start is null
      or b.bill_period_start = input_period_start
    );
$$;

create or replace function public.record_bill_delivery(
  input_customer_id uuid,
  input_bill_period_start date,
  input_amount_kobo integer,
  input_status text default 'delivered',
  input_delivery_note text default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  tenant_id uuid := public.current_operator_id();
  staff_id uuid;
  new_id uuid;
  status text := lower(trim(coalesce(input_status, 'delivered')));
begin
  if public.current_app_role() not in ('operator_owner', 'operations_supervisor', 'collection_agent') then
    raise exception 'Not allowed to record bill delivery';
  end if;

  if status not in ('pending', 'delivered', 'failed', 'disputed') then
    raise exception 'Invalid bill delivery status';
  end if;

  if not exists (
    select 1 from public.customers
    where id = input_customer_id and operator_id = tenant_id
  ) then
    raise exception 'Customer not found';
  end if;

  select id into staff_id
  from public.staff_members
  where profile_id = auth.uid()
    and operator_id = tenant_id
  limit 1;

  insert into public.bill_deliveries (
    operator_id,
    customer_id,
    bill_period_start,
    amount_kobo,
    status,
    delivered_by_staff_id,
    delivered_at,
    delivery_note
  )
  values (
    tenant_id,
    input_customer_id,
    input_bill_period_start,
    greatest(input_amount_kobo, 0),
    status,
    staff_id,
    case when status = 'delivered' then now() else null end,
    nullif(trim(coalesce(input_delivery_note, '')), '')
  )
  on conflict (operator_id, customer_id, bill_period_start) do update
  set
    amount_kobo = excluded.amount_kobo,
    status = excluded.status,
    delivered_by_staff_id = excluded.delivered_by_staff_id,
    delivered_at = excluded.delivered_at,
    delivery_note = excluded.delivery_note
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.list_bill_deliveries(date) to authenticated;
grant execute on function public.record_bill_delivery(uuid, date, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- (d) Compliance cases
-- ---------------------------------------------------------------------------
create table if not exists public.compliance_cases (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  case_type text not null
    check (case_type in ('illegal_dumping', 'skeletal_service', 'irregular_service')),
  status text not null default 'open'
    check (status in ('open', 'investigating', 'closed', 'referred')),
  route_id uuid references public.routes(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  zone_id uuid references public.zones(id) on delete set null,
  title text not null,
  description text not null,
  reported_by_staff_id uuid references public.staff_members(id) on delete set null,
  incident_report_id uuid references public.incident_reports(id) on delete set null,
  closed_at timestamptz,
  closure_notes text,
  created_at timestamptz not null default now()
);

create index if not exists compliance_cases_operator_status_idx
  on public.compliance_cases (operator_id, status, created_at desc);

alter table public.compliance_cases enable row level security;

create policy "tenant read compliance cases"
  on public.compliance_cases for select
  using (operator_id = public.current_operator_id());

create policy "managers write compliance cases"
  on public.compliance_cases for all
  using (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor')
  )
  with check (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor')
  );

create or replace function public.list_compliance_cases()
returns jsonb
language sql
stable
security invoker
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'caseType', c.case_type,
        'status', c.status,
        'title', c.title,
        'description', c.description,
        'customerName', customers.display_name,
        'zoneName', zones.name,
        'routeId', c.route_id,
        'closedAt', c.closed_at,
        'closureNotes', c.closure_notes,
        'createdAt', c.created_at
      )
      order by
        case when c.status in ('open', 'investigating') then 0 else 1 end,
        c.created_at desc
    ),
    '[]'::jsonb
  )
  from public.compliance_cases c
  left join public.customers on customers.id = c.customer_id
  left join public.zones on zones.id = c.zone_id
  where c.operator_id = public.current_operator_id();
$$;

create or replace function public.create_compliance_case(
  input_case_type text,
  input_title text,
  input_description text,
  input_customer_id uuid default null,
  input_route_id uuid default null,
  input_zone_id uuid default null,
  input_incident_report_id uuid default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  tenant_id uuid := public.current_operator_id();
  staff_id uuid;
  new_id uuid;
  case_type text := lower(trim(input_case_type));
begin
  if public.current_app_role() not in ('operator_owner', 'operations_supervisor') then
    raise exception 'Not allowed to create compliance cases';
  end if;

  if case_type not in ('illegal_dumping', 'skeletal_service', 'irregular_service') then
    raise exception 'Invalid compliance case type';
  end if;

  select id into staff_id
  from public.staff_members
  where profile_id = auth.uid() and operator_id = tenant_id
  limit 1;

  insert into public.compliance_cases (
    operator_id,
    case_type,
    title,
    description,
    customer_id,
    route_id,
    zone_id,
    reported_by_staff_id,
    incident_report_id
  )
  values (
    tenant_id,
    case_type,
    trim(input_title),
    trim(input_description),
    input_customer_id,
    input_route_id,
    input_zone_id,
    staff_id,
    input_incident_report_id
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.update_compliance_case_status(
  input_case_id uuid,
  next_status text,
  input_closure_notes text default null
)
returns void
language plpgsql
security invoker
as $$
declare
  status text := lower(trim(next_status));
begin
  if public.current_app_role() not in ('operator_owner', 'operations_supervisor') then
    raise exception 'Not allowed to update compliance cases';
  end if;

  if status not in ('open', 'investigating', 'closed', 'referred') then
    raise exception 'Invalid compliance status';
  end if;

  update public.compliance_cases
  set
    status = status,
    closed_at = case when status = 'closed' then coalesce(closed_at, now()) else null end,
    closure_notes = coalesce(nullif(trim(coalesce(input_closure_notes, '')), ''), closure_notes)
  where id = input_case_id
    and operator_id = public.current_operator_id();

  if not found then
    raise exception 'Compliance case not found';
  end if;
end;
$$;

grant execute on function public.list_compliance_cases() to authenticated;
grant execute on function public.create_compliance_case(text, text, text, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.update_compliance_case_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- (e) Vehicle branding / PPE checklists
-- ---------------------------------------------------------------------------
create table if not exists public.vehicle_branding_checklists (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  truck_id uuid not null references public.trucks(id) on delete cascade,
  route_id uuid references public.routes(id) on delete set null,
  checked_by_staff_id uuid references public.staff_members(id) on delete set null,
  checked_at timestamptz not null default now(),
  scheduled_date date not null default current_date,
  ward_inscription_ok boolean not null default false,
  phone_displayed_ok boolean not null default false,
  colour_coding_ok boolean not null default false,
  amber_light_ok boolean not null default false,
  netting_or_tarpaulin_ok boolean not null default false,
  gang_ppe_ok boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists vehicle_branding_checklists_operator_date_idx
  on public.vehicle_branding_checklists (operator_id, scheduled_date desc);

alter table public.vehicle_branding_checklists enable row level security;

create policy "tenant read vehicle branding checklists"
  on public.vehicle_branding_checklists for select
  using (operator_id = public.current_operator_id());

create policy "staff write vehicle branding checklists"
  on public.vehicle_branding_checklists for insert
  with check (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'driver')
  );

create or replace function public.list_vehicle_branding_checklists(input_date date default current_date)
returns jsonb
language sql
stable
security invoker
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', v.id,
        'truckId', v.truck_id,
        'truckRegistration', trucks.registration_number,
        'routeId', v.route_id,
        'checkedAt', v.checked_at,
        'scheduledDate', v.scheduled_date,
        'wardInscriptionOk', v.ward_inscription_ok,
        'phoneDisplayedOk', v.phone_displayed_ok,
        'colourCodingOk', v.colour_coding_ok,
        'amberLightOk', v.amber_light_ok,
        'nettingOrTarpaulinOk', v.netting_or_tarpaulin_ok,
        'gangPpeOk', v.gang_ppe_ok,
        'passed',
          v.ward_inscription_ok
          and v.phone_displayed_ok
          and v.colour_coding_ok
          and v.amber_light_ok
          and v.netting_or_tarpaulin_ok
          and v.gang_ppe_ok,
        'notes', v.notes,
        'checkedByName', staff_members.full_name
      )
      order by v.checked_at desc
    ),
    '[]'::jsonb
  )
  from public.vehicle_branding_checklists v
  join public.trucks on trucks.id = v.truck_id
  left join public.staff_members on staff_members.id = v.checked_by_staff_id
  where v.operator_id = public.current_operator_id()
    and v.scheduled_date = coalesce(input_date, current_date);
$$;

create or replace function public.record_vehicle_branding_checklist(
  input_truck_id uuid,
  input_ward_inscription_ok boolean,
  input_phone_displayed_ok boolean,
  input_colour_coding_ok boolean,
  input_amber_light_ok boolean,
  input_netting_or_tarpaulin_ok boolean,
  input_gang_ppe_ok boolean,
  input_route_id uuid default null,
  input_notes text default null,
  input_scheduled_date date default current_date
)
returns uuid
language plpgsql
security invoker
as $$
declare
  tenant_id uuid := public.current_operator_id();
  staff_id uuid;
  new_id uuid;
begin
  if public.current_app_role() not in ('operator_owner', 'operations_supervisor', 'driver') then
    raise exception 'Not allowed to record vehicle checklist';
  end if;

  if not exists (
    select 1 from public.trucks where id = input_truck_id and operator_id = tenant_id
  ) then
    raise exception 'Truck not found';
  end if;

  select id into staff_id
  from public.staff_members
  where profile_id = auth.uid() and operator_id = tenant_id
  limit 1;

  insert into public.vehicle_branding_checklists (
    operator_id,
    truck_id,
    route_id,
    checked_by_staff_id,
    scheduled_date,
    ward_inscription_ok,
    phone_displayed_ok,
    colour_coding_ok,
    amber_light_ok,
    netting_or_tarpaulin_ok,
    gang_ppe_ok,
    notes
  )
  values (
    tenant_id,
    input_truck_id,
    input_route_id,
    staff_id,
    coalesce(input_scheduled_date, current_date),
    coalesce(input_ward_inscription_ok, false),
    coalesce(input_phone_displayed_ok, false),
    coalesce(input_colour_coding_ok, false),
    coalesce(input_amber_light_ok, false),
    coalesce(input_netting_or_tarpaulin_ok, false),
    coalesce(input_gang_ppe_ok, false),
    nullif(trim(coalesce(input_notes, '')), '')
  )
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.list_vehicle_branding_checklists(date) to authenticated;
grant execute on function public.record_vehicle_branding_checklist(
  uuid, boolean, boolean, boolean, boolean, boolean, boolean, uuid, text, date
) to authenticated;
