alter table public.routes
  add column notes text;

alter table public.route_stops
  add column skip_reason text,
  add column updated_at timestamptz not null default now();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger route_stops_touch_updated_at
  before update on public.route_stops
  for each row
  execute function public.touch_updated_at();

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

  return parent_route_id;
end;
$$;

create or replace function public.transition_route_status(
  input_route_id uuid,
  next_status public.route_status
)
returns public.route_status
language plpgsql
security invoker
as $$
declare
  current_status public.route_status;
  pending_stops integer;
begin
  select status
  into current_status
  from public.routes
  where id = input_route_id
    and operator_id = public.current_operator_id();

  if current_status is null then
    raise exception 'Route not found';
  end if;

  if current_status = next_status then
    return current_status;
  end if;

  if current_status = 'completed' then
    raise exception 'Completed routes cannot be changed';
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
    and operator_id = public.current_operator_id();

  if not found then
    raise exception 'Route status update was not permitted';
  end if;

  return next_status;
end;
$$;
