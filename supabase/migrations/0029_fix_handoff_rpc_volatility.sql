-- Fix: pending handoff RPCs must not be STABLE while they expire rows (UPDATE).

create or replace function public.pending_driver_handoffs()
returns jsonb
language plpgsql
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
