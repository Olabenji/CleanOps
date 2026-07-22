-- Operator Coverage / Make-good board snapshot (ADO #143 slim — list, no map).

create or replace function public.operator_coverage_snapshot(input_date date default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
  operation_date date := coalesce(input_date, public.operation_current_date());
  app_role text := public.current_app_role();
begin
  if tenant_id is null then
    return null;
  end if;

  if app_role not in (
    'operator_owner',
    'operations_supervisor',
    'platform_admin'
  ) then
    raise exception 'Not allowed to load coverage board';
  end if;

  return (
    with make_goods as (
      select
        mg.id,
        mg.customer_id,
        c.display_name as customer_name,
        z.name as zone_name,
        mg.status,
        mg.source_date,
        mg.target_date,
        mg.due_by,
        mg.attempt_count,
        mg.opened_at,
        mg.completed_at,
        coalesce(
          source_stop.skip_reason,
          source_stop.notes,
          case
            when mg.source_route_stop_id is not null then 'Missed collection'
            else null
          end
        ) as skip_reason,
        case
          when mg.status in ('open', 'scheduled') and mg.due_by < operation_date then true
          else false
        end as overdue,
        case
          when mg.status in ('open', 'scheduled') and mg.target_date <= operation_date then true
          else false
        end as due_today
      from public.collection_make_goods mg
      join public.customers c on c.id = mg.customer_id
      join public.zones z on z.id = c.zone_id
      left join public.route_stops source_stop on source_stop.id = mg.source_route_stop_id
      where mg.operator_id = tenant_id
        and (
          mg.status in ('open', 'scheduled')
          or (
            mg.status = 'completed'
            and coalesce(mg.completed_at::date, mg.source_date) >= operation_date - 14
          )
        )
    ),
    day_stops as (
      select
        rs.status,
        rs.is_make_good
      from public.routes r
      join public.route_stops rs on rs.route_id = r.id
      where r.operator_id = tenant_id
        and r.scheduled_date = operation_date
        and r.status != 'cancelled'
    )
    select jsonb_build_object(
      'operationDate', operation_date,
      'metrics', jsonb_build_object(
        'dueToday', (select count(*)::int from make_goods where due_today),
        'completedToday', (
          select count(*)::int
          from make_goods
          where status = 'completed'
            and completed_at::date = operation_date
        ),
        'open', (select count(*)::int from make_goods where status = 'open'),
        'scheduled', (select count(*)::int from make_goods where status = 'scheduled'),
        'overdue', (select count(*)::int from make_goods where overdue),
        'completedRecent', (select count(*)::int from make_goods where status = 'completed'),
        'stopsDueToday', (select count(*)::int from day_stops),
        'stopsCompletedToday', (
          select count(*)::int from day_stops where status = 'completed'
        ),
        'makeGoodStopsToday', (
          select count(*)::int from day_stops where is_make_good
        )
      ),
      'items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', id,
              'customerId', customer_id,
              'customerName', customer_name,
              'zoneName', zone_name,
              'status', status,
              'sourceDate', source_date,
              'targetDate', target_date,
              'dueBy', due_by,
              'attemptCount', attempt_count,
              'skipReason', skip_reason,
              'openedAt', opened_at,
              'completedAt', completed_at,
              'overdue', overdue,
              'dueToday', due_today
            )
            order by
              case
                when overdue then 0
                when due_today then 1
                when status = 'open' then 2
                when status = 'scheduled' then 3
                else 4
              end,
              target_date,
              customer_name
          )
          from make_goods
        ),
        '[]'::jsonb
      )
    )
  );
end;
$$;

grant execute on function public.operator_coverage_snapshot(date) to authenticated;
