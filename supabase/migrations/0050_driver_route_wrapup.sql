-- Driver wrap-up: do not auto-complete routes when the last stop is done.
-- Drivers explicitly end the route after dumpsite logging / review.

create or replace function public.reconcile_route_progress(input_route_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  route_record public.routes%rowtype;
  pending_count integer;
  total_count integer;
  active_stop_count integer;
begin
  select *
  into route_record
  from public.routes
  where id = input_route_id
    and operator_id = public.current_operator_id();

  if route_record.id is null or route_record.status = 'cancelled' then
    return;
  end if;

  select
    count(*) filter (where status = 'pending'),
    count(*),
    count(*) filter (where status in ('completed', 'skipped', 'missed_reported'))
  into pending_count, total_count, active_stop_count
  from public.route_stops
  where route_id = input_route_id;

  if total_count = 0 then
    return;
  end if;

  -- Keep routes open after the last stop so drivers can log dumpsite runs and wrap up.
  -- Explicit completion uses transition_route_status / driver end-route.

  if route_record.status = 'completed' and pending_count > 0 then
    update public.routes
    set
      status = 'in_progress',
      completed_at = null
    where id = input_route_id;
    return;
  end if;

  if active_stop_count > 0 and route_record.status = 'scheduled' then
    update public.routes
    set
      status = 'in_progress',
      started_at = coalesce(started_at, now())
    where id = input_route_id;
  end if;
end;
$$;

create or replace function public.transition_route_status(
  input_route_id uuid,
  next_status public.route_status
)
returns public.route_status
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
  route_record public.routes%rowtype;
  current_status public.route_status;
  pending_stops integer;
  driver_staff_id uuid;
  app_role text := public.current_app_role();
begin
  if tenant_id is null then
    raise exception 'Not authenticated';
  end if;

  select *
  into route_record
  from public.routes
  where id = input_route_id
    and operator_id = tenant_id;

  if route_record.id is null then
    raise exception 'Route not found';
  end if;

  current_status := route_record.status;

  if current_status = next_status then
    return current_status;
  end if;

  if current_status = 'completed' then
    raise exception 'Completed routes cannot be changed';
  end if;

  select id
  into driver_staff_id
  from public.staff_members
  where profile_id = auth.uid()
    and operator_id = tenant_id
    and role = 'driver'
    and active
  limit 1;

  if app_role not in ('operator_owner', 'operations_supervisor') then
    -- Assigned drivers may only complete their own in-progress route after stops are done.
    if not (
      driver_staff_id is not null
      and route_record.driver_id = driver_staff_id
      and next_status = 'completed'
    ) then
      raise exception 'Not allowed to change this route status';
    end if;
  end if;

  if next_status = 'in_progress' and current_status != 'scheduled' then
    raise exception 'Only scheduled routes can be started';
  end if;

  if next_status = 'completed' and current_status != 'in_progress' then
    raise exception 'Only in-progress routes can be completed';
  end if;

  if next_status = 'completed' then
    select count(*)
    into pending_stops
    from public.route_stops
    where route_id = input_route_id
      and status = 'pending';

    if pending_stops > 0 then
      raise exception 'All route stops must be completed or skipped before completing the route';
    end if;
  end if;

  if next_status = 'cancelled' and current_status not in ('scheduled', 'in_progress') then
    raise exception 'Route cannot be cancelled from current status';
  end if;

  if next_status = 'cancelled' and app_role not in ('operator_owner', 'operations_supervisor') then
    raise exception 'Only operators can cancel routes';
  end if;

  update public.routes
  set
    status = next_status,
    started_at = case
      when next_status = 'in_progress' and started_at is null then now()
      else started_at
    end,
    completed_at = case
      when next_status = 'completed' then now()
      when next_status = 'cancelled' then now()
      else completed_at
    end
  where id = input_route_id
    and operator_id = tenant_id;

  if not found then
    raise exception 'Route status update was not permitted';
  end if;

  return next_status;
end;
$$;

grant execute on function public.transition_route_status(uuid, public.route_status) to authenticated;
