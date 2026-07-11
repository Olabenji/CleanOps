-- Part 2: propose/apply RPCs for truck / driver / both reassignment.

drop function if exists public.propose_route_truck_handoff(
  uuid, uuid, uuid, public.route_truck_handoff_reason, text, uuid, public.route_truck_handoff_source_outcome
);

create or replace function public.propose_route_truck_handoff(
  input_route_id uuid,
  input_to_truck_id uuid,
  input_to_driver_id uuid,
  input_reason public.route_truck_handoff_reason,
  input_notes text default null,
  input_source_route_id uuid default null,
  input_source_outcome public.route_truck_handoff_source_outcome default null,
  input_change_kind public.route_reassignment_kind default 'both'
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
  resolved_truck_id uuid;
  truck_changing boolean;
  driver_changing boolean;
begin
  perform public.expire_stale_route_truck_handoffs();

  if tenant_id is null then
    raise exception 'Operator profile not found';
  end if;

  if public.current_app_role() not in ('operator_owner', 'operations_supervisor') then
    raise exception 'Only operators and supervisors can propose route reassignments';
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
    raise exception 'This route already has a pending reassignment';
  end if;

  if input_change_kind = 'driver' then
    if route_record.truck_id is null then
      raise exception 'Driver-only reassignment needs a truck already on the route';
    end if;
    resolved_truck_id := route_record.truck_id;
  else
    resolved_truck_id := input_to_truck_id;
  end if;

  select *
  into to_truck
  from public.trucks
  where id = resolved_truck_id
    and operator_id = tenant_id
    and active;

  if to_truck.id is null then
    raise exception 'Replacement truck not found or inactive';
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

  truck_changing := route_record.truck_id is distinct from resolved_truck_id;
  driver_changing := route_record.driver_id is distinct from input_to_driver_id;

  if input_change_kind = 'truck' and not truck_changing then
    raise exception 'Truck reassignment requires a different truck';
  end if;

  if input_change_kind = 'driver' and not driver_changing then
    raise exception 'Driver reassignment requires a different driver';
  end if;

  if input_change_kind = 'driver' and truck_changing then
    raise exception 'Driver-only reassignment must keep the same truck';
  end if;

  if input_change_kind = 'both' and not truck_changing and not driver_changing then
    raise exception 'Nothing changed — pick a different truck and/or driver';
  end if;

  if input_change_kind = 'truck' and input_reason in ('driver_sick', 'driver_unavailable') then
    raise exception 'Use a truck-related reason for truck reassignment';
  end if;

  if input_change_kind = 'driver' and input_reason in ('breakdown', 'dumpsite_delay') then
    raise exception 'Use a driver-related reason (sick / unavailable) for driver reassignment';
  end if;

  -- Replacement driver cannot already own another active route today.
  if driver_changing and exists (
    select 1
    from public.routes
    where operator_id = tenant_id
      and scheduled_date = route_record.scheduled_date
      and driver_id = input_to_driver_id
      and id <> input_route_id
      and status not in ('completed', 'cancelled')
  ) then
    raise exception 'Replacement driver is already assigned on another route today';
  end if;

  if truck_changing then
    select *
    into occupying_route
    from public.routes
    where operator_id = tenant_id
      and scheduled_date = route_record.scheduled_date
      and truck_id = resolved_truck_id
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
  elsif input_source_route_id is not null then
    raise exception 'Source route is only valid when the truck is changing';
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
    initiated_by_staff_id,
    change_kind
  )
  values (
    tenant_id,
    route_record.id,
    route_record.truck_id,
    resolved_truck_id,
    route_record.driver_id,
    input_to_driver_id,
    case when truck_changing then input_source_route_id else null end,
    case when truck_changing then input_source_outcome else null end,
    input_reason,
    nullif(trim(coalesce(input_notes, '')), ''),
    initiator_staff_id,
    input_change_kind
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
  truck_changing boolean;
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

  truck_changing := handoff.from_truck_id is distinct from handoff.to_truck_id;

  if handoff.source_route_id is not null and truck_changing then
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

  -- Workshop only when the vehicle actually changes for a breakdown.
  if handoff.reason = 'breakdown' and truck_changing and handoff.from_truck_id is not null then
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
