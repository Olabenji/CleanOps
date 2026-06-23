create policy "tenant staff create incidents"
  on public.incident_reports for insert
  with check (
    operator_id = public.current_operator_id()
    and exists (
      select 1
      from public.staff_members
      where staff_members.id = incident_reports.reported_by_staff_id
        and staff_members.operator_id = public.current_operator_id()
        and staff_members.profile_id = auth.uid()
        and staff_members.active
    )
  );

create or replace function public.report_driver_incident(
  input_route_id uuid,
  input_stop_id uuid default null,
  input_incident_type text default 'other',
  input_title text default null,
  input_description text default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  driver_staff_id uuid;
  route_record public.routes%rowtype;
  stop_label text;
  incident_id uuid;
  incident_title text;
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
    raise exception 'Only active drivers can report incidents';
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

  if input_stop_id is not null then
    select customers.display_name
    into stop_label
    from public.route_stops
    join public.customers on customers.id = route_stops.customer_id
    where route_stops.id = input_stop_id
      and route_stops.route_id = input_route_id;

    if stop_label is null then
      raise exception 'Route stop not found';
    end if;
  end if;

  incident_title := coalesce(
    nullif(trim(input_title), ''),
    initcap(replace(input_incident_type, '_', ' '))
  );

  insert into public.incident_reports (
    operator_id,
    route_id,
    truck_id,
    reported_by_staff_id,
    title,
    description
  )
  values (
    route_record.operator_id,
    route_record.id,
    route_record.truck_id,
    driver_staff_id,
    incident_title,
    concat(
      '[', input_incident_type, '] ',
      case when stop_label is not null then concat('Stop: ', stop_label, '. ') else '' end,
      trim(coalesce(input_description, 'No description provided.'))
    )
  )
  returning id into incident_id;

  return jsonb_build_object(
    'id', incident_id,
    'createdAt', now()
  );
end;
$$;

create or replace function public.recent_incident_reports(input_limit integer default 10)
returns jsonb
language sql
stable
security invoker
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', incidents.id,
        'routeId', incidents.route_id,
        'routeLabel', zones.name,
        'truckRegistration', trucks.registration_number,
        'reportedBy', staff_members.full_name,
        'title', incidents.title,
        'description', incidents.description,
        'resolvedAt', incidents.resolved_at,
        'createdAt', incidents.created_at
      )
      order by incidents.created_at desc
    ),
    '[]'::jsonb
  )
  from (
    select *
    from public.incident_reports
    where operator_id = public.current_operator_id()
    order by created_at desc
    limit least(greatest(input_limit, 1), 50)
  ) incidents
  left join public.routes on routes.id = incidents.route_id
  left join public.zones on zones.id = routes.zone_id
  left join public.trucks on trucks.id = incidents.truck_id
  left join public.staff_members on staff_members.id = incidents.reported_by_staff_id;
$$;
