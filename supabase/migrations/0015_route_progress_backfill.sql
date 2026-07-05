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

  if pending_count = 0 and route_record.status in ('scheduled', 'in_progress') then
    update public.routes
    set
      status = 'completed',
      started_at = coalesce(started_at, now()),
      completed_at = coalesce(completed_at, now())
    where id = input_route_id;
    return;
  end if;

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

create or replace function public.reconcile_routes_for_date(input_date date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  route_id uuid;
  reconciled_count integer := 0;
begin
  if public.current_operator_id() is null then
    raise exception 'Operator profile not found';
  end if;

  for route_id in
    select routes.id
    from public.routes
    where routes.operator_id = public.current_operator_id()
      and routes.scheduled_date = input_date
      and routes.status != 'cancelled'
  loop
    perform public.reconcile_route_progress(route_id);
    reconciled_count := reconciled_count + 1;
  end loop;

  return reconciled_count;
end;
$$;

update public.routes as routes
set
  status = case
    when stop_stats.pending_count = 0 and stop_stats.total_count > 0 then 'completed'::public.route_status
    when stop_stats.active_count > 0 then 'in_progress'::public.route_status
    else routes.status
  end,
  started_at = case
    when stop_stats.active_count > 0 or (stop_stats.pending_count = 0 and stop_stats.total_count > 0)
      then coalesce(routes.started_at, now())
    else routes.started_at
  end,
  completed_at = case
    when stop_stats.pending_count = 0 and stop_stats.total_count > 0
      then coalesce(routes.completed_at, now())
    when stop_stats.pending_count > 0 then null
    else routes.completed_at
  end
from (
  select
    route_stops.route_id,
    count(*) filter (where route_stops.status = 'pending') as pending_count,
    count(*) as total_count,
    count(*) filter (
      where route_stops.status in ('completed', 'skipped', 'missed_reported')
    ) as active_count
  from public.route_stops
  group by route_stops.route_id
) as stop_stats
where routes.id = stop_stats.route_id
  and routes.status != 'cancelled';
