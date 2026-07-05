create or replace function public.reconcile_route_progress(input_route_id uuid)
returns void
language plpgsql
security invoker
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
      completed_at = now()
    where id = input_route_id
      and operator_id = public.current_operator_id();
    return;
  end if;

  if route_record.status = 'completed' and pending_count > 0 then
    update public.routes
    set
      status = 'in_progress',
      completed_at = null
    where id = input_route_id
      and operator_id = public.current_operator_id();
    return;
  end if;

  if active_stop_count > 0 and route_record.status = 'scheduled' then
    update public.routes
    set
      status = 'in_progress',
      started_at = coalesce(started_at, now())
    where id = input_route_id
      and operator_id = public.current_operator_id();
  end if;
end;
$$;

create or replace function public.update_route_stop_status(
  input_stop_id uuid,
  next_status public.route_stop_status,
  input_notes text default null,
  input_skip_reason text default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  parent_route_id uuid;
begin
  select route_id
  into parent_route_id
  from public.route_stops
  where id = input_stop_id;

  if parent_route_id is null then
    raise exception 'Route stop not found';
  end if;

  if next_status = 'skipped' and nullif(trim(coalesce(input_skip_reason, '')), '') is null then
    raise exception 'Skip reason is required';
  end if;

  update public.route_stops
  set
    status = next_status,
    completed_at = case when next_status = 'completed' then now() else null end,
    notes = nullif(trim(coalesce(input_notes, notes, '')), ''),
    skip_reason = case
      when next_status = 'skipped' then nullif(trim(coalesce(input_skip_reason, '')), '')
      else null
    end
  where id = input_stop_id;

  if not found then
    raise exception 'Route stop update was not permitted';
  end if;

  perform public.reconcile_route_progress(parent_route_id);

  return parent_route_id;
end;
$$;
