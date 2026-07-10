-- Sprint 5: operator-initiated truck reassignment with driver confirmation.

create type public.route_truck_handoff_status as enum (
  'awaiting_confirmation',
  'confirmed',
  'rejected',
  'cancelled',
  'expired'
);

create type public.route_truck_handoff_reason as enum (
  'breakdown',
  'dumpsite_delay',
  'unable_to_start',
  'cross_route_support',
  'other'
);

create type public.route_truck_handoff_source_outcome as enum (
  'leave_unassigned',
  'cancel_route'
);

-- Allow routes to temporarily have no truck after a borrow.
alter table public.routes
  alter column truck_id drop not null;

create table public.route_truck_handoffs (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  from_truck_id uuid references public.trucks(id) on delete set null,
  to_truck_id uuid not null references public.trucks(id) on delete restrict,
  from_driver_id uuid references public.staff_members(id) on delete set null,
  to_driver_id uuid not null references public.staff_members(id) on delete restrict,
  source_route_id uuid references public.routes(id) on delete set null,
  source_outcome public.route_truck_handoff_source_outcome,
  reason public.route_truck_handoff_reason not null,
  notes text,
  status public.route_truck_handoff_status not null default 'awaiting_confirmation',
  initiated_by_staff_id uuid references public.staff_members(id) on delete set null,
  incoming_confirmed_at timestamptz,
  outgoing_confirmed_at timestamptz,
  rejected_by_staff_id uuid references public.staff_members(id) on delete set null,
  rejection_note text,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  confirmed_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint route_truck_handoffs_different_truck check (from_truck_id is distinct from to_truck_id)
);

create unique index route_truck_handoffs_one_open_per_route_idx
  on public.route_truck_handoffs (route_id)
  where status = 'awaiting_confirmation';

create index route_truck_handoffs_pending_driver_idx
  on public.route_truck_handoffs (to_driver_id, from_driver_id, status);

alter table public.route_truck_handoffs enable row level security;

create policy "tenant read route truck handoffs"
  on public.route_truck_handoffs for select
  using (operator_id = public.current_operator_id());

create or replace function public.expire_stale_route_truck_handoffs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_count integer;
begin
  update public.route_truck_handoffs
  set status = 'expired'
  where status = 'awaiting_confirmation'
    and expires_at < now();

  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;

create or replace function public.route_truck_handoff_json(handoff public.route_truck_handoffs)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', handoff.id,
    'routeId', handoff.route_id,
    'routeZoneName', zones.name,
    'routeStatus', routes.status,
    'scheduledDate', routes.scheduled_date,
    'pendingStops', (
      select count(*)::int
      from public.route_stops
      where route_stops.route_id = handoff.route_id
        and route_stops.status = 'pending'
    ),
    'fromTruckId', handoff.from_truck_id,
    'fromTruckRegistration', from_truck.registration_number,
    'toTruckId', handoff.to_truck_id,
    'toTruckRegistration', to_truck.registration_number,
    'fromDriverId', handoff.from_driver_id,
    'fromDriverName', from_driver.full_name,
    'toDriverId', handoff.to_driver_id,
    'toDriverName', to_driver.full_name,
    'sourceRouteId', handoff.source_route_id,
    'sourceRouteZoneName', source_zone.name,
    'sourceOutcome', handoff.source_outcome,
    'reason', handoff.reason,
    'notes', handoff.notes,
    'status', handoff.status,
    'requiresOutgoingConfirmation', (
      handoff.from_driver_id is not null
      and handoff.from_driver_id is distinct from handoff.to_driver_id
      and routes.status = 'in_progress'
    ),
    'incomingConfirmed', handoff.incoming_confirmed_at is not null,
    'outgoingConfirmed', handoff.outgoing_confirmed_at is not null,
    'expiresAt', handoff.expires_at,
    'createdAt', handoff.created_at,
    'confirmedAt', handoff.confirmed_at,
    'rejectedAt', handoff.rejected_at,
    'cancelledAt', handoff.cancelled_at
  )
  from public.routes
  join public.zones on zones.id = routes.zone_id
  join public.trucks to_truck on to_truck.id = handoff.to_truck_id
  left join public.trucks from_truck on from_truck.id = handoff.from_truck_id
  left join public.staff_members from_driver on from_driver.id = handoff.from_driver_id
  left join public.staff_members to_driver on to_driver.id = handoff.to_driver_id
  left join public.routes source_route on source_route.id = handoff.source_route_id
  left join public.zones source_zone on source_zone.id = source_route.zone_id
  where routes.id = handoff.route_id;
$$;

create or replace function public.propose_route_truck_handoff(
  input_route_id uuid,
  input_to_truck_id uuid,
  input_to_driver_id uuid,
  input_reason public.route_truck_handoff_reason,
  input_notes text default null,
  input_source_route_id uuid default null,
  input_source_outcome public.route_truck_handoff_source_outcome default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
  initiator_staff_id uuid;
  route_record public.routes%rowtype;
  to_truck public.trucks%rowtype;
  source_route public.routes%rowtype;
  occupying_route public.routes%rowtype;
  new_handoff public.route_truck_handoffs%rowtype;
begin
  perform public.expire_stale_route_truck_handoffs();

  if tenant_id is null then
    raise exception 'Operator profile not found';
  end if;

  if public.current_app_role() not in ('operator_owner', 'operations_supervisor') then
    raise exception 'Only operators and supervisors can propose truck handoffs';
  end if;

  select id
  into initiator_staff_id
  from public.staff_members
  where profile_id = auth.uid()
    and operator_id = tenant_id
    and active
  limit 1;

  select *
  into route_record
  from public.routes
  where id = input_route_id
    and operator_id = tenant_id;

  if route_record.id is null then
    raise exception 'Route not found';
  end if;

  if route_record.status in ('completed', 'cancelled') then
    raise exception 'Completed or cancelled routes cannot be reassigned';
  end if;

  if exists (
    select 1
    from public.route_truck_handoffs
    where route_id = input_route_id
      and status = 'awaiting_confirmation'
  ) then
    raise exception 'This route already has a pending truck handoff';
  end if;

  select *
  into to_truck
  from public.trucks
  where id = input_to_truck_id
    and operator_id = tenant_id
    and active;

  if to_truck.id is null then
    raise exception 'Replacement truck not found or inactive';
  end if;

  if route_record.truck_id is not null and route_record.truck_id = input_to_truck_id then
    raise exception 'Replacement truck must be different from the current truck';
  end if;

  if not exists (
    select 1
    from public.staff_members
    where id = input_to_driver_id
      and operator_id = tenant_id
      and role = 'driver'
      and active
  ) then
    raise exception 'Replacement driver not found or inactive';
  end if;

  select *
  into occupying_route
  from public.routes
  where operator_id = tenant_id
    and scheduled_date = route_record.scheduled_date
    and truck_id = input_to_truck_id
    and id <> input_route_id
    and status not in ('completed', 'cancelled')
  limit 1;

  if occupying_route.id is not null then
    if input_source_route_id is null or input_source_route_id <> occupying_route.id then
      raise exception 'Replacement truck is assigned to another route; set source route to borrow it';
    end if;

    if input_source_outcome is null then
      raise exception 'Choose what happens to the source route when borrowing its truck';
    end if;

    if occupying_route.status = 'in_progress' and occupying_route.started_at is not null then
      raise exception 'Cannot borrow a truck from an in-progress route; finish or hand off that route first';
    end if;
  elsif input_source_route_id is not null then
    raise exception 'Source route is only valid when borrowing a truck from another route';
  end if;

  if input_source_route_id is not null then
    select *
    into source_route
    from public.routes
    where id = input_source_route_id
      and operator_id = tenant_id;

    if source_route.id is null then
      raise exception 'Source route not found';
    end if;
  end if;

  insert into public.route_truck_handoffs (
    operator_id,
    route_id,
    from_truck_id,
    to_truck_id,
    from_driver_id,
    to_driver_id,
    source_route_id,
    source_outcome,
    reason,
    notes,
    initiated_by_staff_id
  )
  values (
    tenant_id,
    route_record.id,
    route_record.truck_id,
    input_to_truck_id,
    route_record.driver_id,
    input_to_driver_id,
    input_source_route_id,
    input_source_outcome,
    input_reason,
    nullif(trim(input_notes), ''),
    initiator_staff_id
  )
  returning * into new_handoff;

  return public.route_truck_handoff_json(new_handoff);
end;
$$;

create or replace function public.apply_confirmed_route_truck_handoff(input_handoff_id uuid)
returns public.route_truck_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  handoff public.route_truck_handoffs%rowtype;
  route_record public.routes%rowtype;
  requires_outgoing boolean;
begin
  select *
  into handoff
  from public.route_truck_handoffs
  where id = input_handoff_id
  for update;

  if handoff.id is null then
    raise exception 'Handoff not found';
  end if;

  if handoff.status <> 'awaiting_confirmation' then
    return handoff;
  end if;

  if handoff.expires_at < now() then
    update public.route_truck_handoffs
    set status = 'expired'
    where id = handoff.id
    returning * into handoff;
    return handoff;
  end if;

  select *
  into route_record
  from public.routes
  where id = handoff.route_id
  for update;

  requires_outgoing :=
    handoff.from_driver_id is not null
    and handoff.from_driver_id is distinct from handoff.to_driver_id
    and route_record.status = 'in_progress';

  if handoff.incoming_confirmed_at is null then
    return handoff;
  end if;

  if requires_outgoing and handoff.outgoing_confirmed_at is null then
    return handoff;
  end if;

  if handoff.source_route_id is not null then
    if handoff.source_outcome = 'cancel_route' then
      update public.routes
      set
        status = 'cancelled',
        completed_at = coalesce(completed_at, now()),
        truck_id = null
      where id = handoff.source_route_id
        and operator_id = handoff.operator_id
        and status not in ('completed', 'cancelled');
    else
      update public.routes
      set truck_id = null
      where id = handoff.source_route_id
        and operator_id = handoff.operator_id
        and status not in ('completed', 'cancelled');
    end if;
  end if;

  update public.routes
  set
    truck_id = handoff.to_truck_id,
    driver_id = handoff.to_driver_id
  where id = handoff.route_id;

  if handoff.reason = 'breakdown' and handoff.from_truck_id is not null then
    update public.trucks
    set status = 'workshop'
    where id = handoff.from_truck_id
      and operator_id = handoff.operator_id;
  end if;

  update public.route_truck_handoffs
  set
    status = 'confirmed',
    confirmed_at = now()
  where id = handoff.id
  returning * into handoff;

  return handoff;
end;
$$;

create or replace function public.confirm_route_truck_handoff(input_handoff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  driver_staff_id uuid;
  handoff public.route_truck_handoffs%rowtype;
  route_record public.routes%rowtype;
  requires_outgoing boolean;
begin
  perform public.expire_stale_route_truck_handoffs();

  select id
  into driver_staff_id
  from public.staff_members
  where profile_id = auth.uid()
    and operator_id = public.current_operator_id()
    and role = 'driver'
    and active
  limit 1;

  if driver_staff_id is null then
    raise exception 'Only active drivers can confirm truck handoffs';
  end if;

  select *
  into handoff
  from public.route_truck_handoffs
  where id = input_handoff_id
    and operator_id = public.current_operator_id()
  for update;

  if handoff.id is null then
    raise exception 'Handoff not found';
  end if;

  if handoff.status <> 'awaiting_confirmation' then
    raise exception 'Handoff is no longer awaiting confirmation';
  end if;

  if handoff.expires_at < now() then
    update public.route_truck_handoffs
    set status = 'expired'
    where id = handoff.id;
    raise exception 'Handoff has expired';
  end if;

  select *
  into route_record
  from public.routes
  where id = handoff.route_id;

  requires_outgoing :=
    handoff.from_driver_id is not null
    and handoff.from_driver_id is distinct from handoff.to_driver_id
    and route_record.status = 'in_progress';

  if driver_staff_id = handoff.to_driver_id then
    update public.route_truck_handoffs
    set incoming_confirmed_at = coalesce(incoming_confirmed_at, now())
    where id = handoff.id;
  elsif requires_outgoing and driver_staff_id = handoff.from_driver_id then
    update public.route_truck_handoffs
    set outgoing_confirmed_at = coalesce(outgoing_confirmed_at, now())
    where id = handoff.id;
  else
    raise exception 'You are not a required party on this handoff';
  end if;

  handoff := public.apply_confirmed_route_truck_handoff(input_handoff_id);
  return public.route_truck_handoff_json(handoff);
end;
$$;

create or replace function public.reject_route_truck_handoff(
  input_handoff_id uuid,
  input_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_staff_id uuid;
  handoff public.route_truck_handoffs%rowtype;
  is_operator boolean := public.current_app_role() in ('operator_owner', 'operations_supervisor');
begin
  perform public.expire_stale_route_truck_handoffs();

  select id
  into actor_staff_id
  from public.staff_members
  where profile_id = auth.uid()
    and operator_id = public.current_operator_id()
    and active
  limit 1;

  select *
  into handoff
  from public.route_truck_handoffs
  where id = input_handoff_id
    and operator_id = public.current_operator_id()
  for update;

  if handoff.id is null then
    raise exception 'Handoff not found';
  end if;

  if handoff.status <> 'awaiting_confirmation' then
    raise exception 'Handoff is no longer awaiting confirmation';
  end if;

  if not is_operator
    and actor_staff_id is distinct from handoff.to_driver_id
    and actor_staff_id is distinct from handoff.from_driver_id
  then
    raise exception 'You cannot reject this handoff';
  end if;

  update public.route_truck_handoffs
  set
    status = 'rejected',
    rejected_at = now(),
    rejected_by_staff_id = actor_staff_id,
    rejection_note = nullif(trim(input_note), '')
  where id = handoff.id
  returning * into handoff;

  return public.route_truck_handoff_json(handoff);
end;
$$;

create or replace function public.cancel_route_truck_handoff(input_handoff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  handoff public.route_truck_handoffs%rowtype;
begin
  if public.current_app_role() not in ('operator_owner', 'operations_supervisor') then
    raise exception 'Only operators and supervisors can cancel truck handoffs';
  end if;

  select *
  into handoff
  from public.route_truck_handoffs
  where id = input_handoff_id
    and operator_id = public.current_operator_id()
  for update;

  if handoff.id is null then
    raise exception 'Handoff not found';
  end if;

  if handoff.status <> 'awaiting_confirmation' then
    raise exception 'Only pending handoffs can be cancelled';
  end if;

  update public.route_truck_handoffs
  set
    status = 'cancelled',
    cancelled_at = now()
  where id = handoff.id
  returning * into handoff;

  return public.route_truck_handoff_json(handoff);
end;
$$;

create or replace function public.pending_driver_handoffs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  driver_staff_id uuid;
begin
  perform public.expire_stale_route_truck_handoffs();

  select id
  into driver_staff_id
  from public.staff_members
  where profile_id = auth.uid()
    and operator_id = public.current_operator_id()
    and role = 'driver'
    and active
  limit 1;

  if driver_staff_id is null then
    return '[]'::jsonb;
  end if;

  return coalesce(
    (
      select jsonb_agg(public.route_truck_handoff_json(handoffs) order by handoffs.created_at desc)
      from public.route_truck_handoffs handoffs
      join public.routes on routes.id = handoffs.route_id
      where handoffs.operator_id = public.current_operator_id()
        and handoffs.status = 'awaiting_confirmation'
        and handoffs.expires_at >= now()
        and (
          handoffs.to_driver_id = driver_staff_id
          or (
            handoffs.from_driver_id = driver_staff_id
            and handoffs.from_driver_id is distinct from handoffs.to_driver_id
            and routes.status = 'in_progress'
          )
        )
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.route_truck_handoffs_for_date(input_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.expire_stale_route_truck_handoffs();

  if public.current_app_role() not in ('operator_owner', 'operations_supervisor') then
    raise exception 'Only operators and supervisors can list truck handoffs';
  end if;

  return coalesce(
    (
      select jsonb_agg(public.route_truck_handoff_json(handoffs) order by handoffs.created_at desc)
      from public.route_truck_handoffs handoffs
      join public.routes on routes.id = handoffs.route_id
      where handoffs.operator_id = public.current_operator_id()
        and routes.scheduled_date = input_date
        and handoffs.status in ('awaiting_confirmation', 'confirmed', 'rejected', 'cancelled', 'expired')
    ),
    '[]'::jsonb
  );
end;
$$;

-- Driver assigned route must tolerate routes without a truck after a borrow.
create or replace function public.driver_assigned_route(input_date date default current_date)
returns jsonb
language sql
stable
security invoker
as $$
  with driver_staff as (
    select id
    from public.staff_members
    where profile_id = auth.uid()
      and operator_id = public.current_operator_id()
      and role = 'driver'
      and active
    limit 1
  ),
  assigned_route as (
    select routes.*
    from public.routes
    join driver_staff on driver_staff.id = routes.driver_id
    where routes.operator_id = public.current_operator_id()
      and (
        routes.scheduled_date = input_date
        or routes.status in ('scheduled', 'in_progress')
      )
    order by
      case when routes.scheduled_date = input_date then 0 else 1 end,
      routes.scheduled_date desc,
      routes.created_at desc
    limit 1
  )
  select coalesce(
    (
      select jsonb_build_object(
        'id', assigned_route.id,
        'zoneName', zones.name,
        'truckRegistration', coalesce(trucks.registration_number, 'Unassigned truck'),
        'driverName', staff_members.full_name,
        'status', assigned_route.status,
        'completedStops', count(route_stops.id) filter (where route_stops.status = 'completed')::int,
        'totalStops', greatest(count(route_stops.id), 1)::int,
        'delayed', assigned_route.status = 'in_progress'
          and (count(route_stops.id) filter (where route_stops.status = 'completed'))::numeric
            / greatest(count(route_stops.id), 1) < 0.35,
        'scheduledDate', assigned_route.scheduled_date,
        'startedAt', assigned_route.started_at,
        'completedAt', assigned_route.completed_at,
        'stops', coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', route_stops.id,
              'customerName', customers.display_name,
              'address', customers.address,
              'stopSequence', route_stops.stop_sequence,
              'status', route_stops.status,
              'completedAt', route_stops.completed_at,
              'notes', route_stops.notes,
              'skipReason', route_stops.skip_reason,
              'serviceStatus', customers.service_status
            )
            order by route_stops.stop_sequence
          ) filter (where route_stops.id is not null),
          '[]'::jsonb
        )
      )
      from assigned_route
      join public.zones on zones.id = assigned_route.zone_id
      left join public.trucks on trucks.id = assigned_route.truck_id
      left join public.staff_members on staff_members.id = assigned_route.driver_id
      left join public.route_stops on route_stops.route_id = assigned_route.id
      left join public.customers on customers.id = route_stops.customer_id
      group by
        assigned_route.id,
        assigned_route.status,
        assigned_route.scheduled_date,
        assigned_route.started_at,
        assigned_route.completed_at,
        zones.name,
        trucks.registration_number,
        staff_members.full_name
    ),
    'null'::jsonb
  );
$$;
