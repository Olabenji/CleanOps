-- Operator Settings: manage zone default route templates independent of ops date.

create or replace function public.operator_zone_templates_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
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
    raise exception 'Not allowed to load ward templates';
  end if;

  perform public.ensure_zone_default_templates(tenant_id);

  return (
    with zone_rows as (
      select
        zones.id as zone_id,
        zones.name as zone_name,
        templates.id as template_id,
        templates.truck_id,
        trucks.registration_number as truck_registration,
        templates.driver_id,
        coalesce(staff_members.full_name, null) as driver_name,
        templates.updated_at
      from public.zones
      left join public.route_templates templates
        on templates.zone_id = zones.id
       and templates.operator_id = tenant_id
       and templates.kind = 'zone_default'
      left join public.trucks on trucks.id = templates.truck_id
      left join public.staff_members on staff_members.id = templates.driver_id
      where zones.operator_id = tenant_id
    ),
    stop_rows as (
      select
        rts.template_id,
        jsonb_agg(
          jsonb_build_object(
            'customerId', c.id,
            'displayName', c.display_name,
            'address', c.address,
            'customerType', c.customer_type,
            'serviceStatus', c.service_status,
            'collectionsPerWeek', c.collections_per_week,
            'preferredWeekdays', to_jsonb(c.preferred_weekdays),
            'stopSequence', rts.stop_sequence
          )
          order by rts.stop_sequence
        ) as stops
      from public.route_template_stops rts
      join public.customers c on c.id = rts.customer_id
      group by rts.template_id
    ),
    zone_customers as (
      select
        c.zone_id,
        jsonb_agg(
          jsonb_build_object(
            'customerId', c.id,
            'displayName', c.display_name,
            'address', c.address,
            'customerType', c.customer_type,
            'serviceStatus', c.service_status,
            'collectionsPerWeek', c.collections_per_week,
            'preferredWeekdays', to_jsonb(c.preferred_weekdays)
          )
          order by c.display_name
        ) as customers
      from public.customers c
      where c.operator_id = tenant_id
        and c.service_status = 'active'
      group by c.zone_id
    ),
    truck_options as (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', trucks.id,
            'label', trucks.registration_number,
            'zoneId', trucks.zone_id
          )
          order by trucks.registration_number
        ),
        '[]'::jsonb
      ) as trucks
      from public.trucks
      where trucks.operator_id = tenant_id
        and trucks.active
    ),
    driver_options as (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', staff_members.id,
            'label', staff_members.full_name
          )
          order by staff_members.full_name
        ),
        '[]'::jsonb
      ) as drivers
      from public.staff_members
      where staff_members.operator_id = tenant_id
        and staff_members.active
        and staff_members.role = 'driver'
    )
    select jsonb_build_object(
      'zones', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'zoneId', zone_rows.zone_id,
              'zoneName', zone_rows.zone_name,
              'templateId', zone_rows.template_id,
              'truckId', zone_rows.truck_id,
              'truckRegistration', zone_rows.truck_registration,
              'driverId', zone_rows.driver_id,
              'driverName', zone_rows.driver_name,
              'updatedAt', zone_rows.updated_at,
              'stops', coalesce(stop_rows.stops, '[]'::jsonb),
              'availableCustomers', coalesce(zone_customers.customers, '[]'::jsonb)
            )
            order by zone_rows.zone_name
          )
          from zone_rows
          left join stop_rows on stop_rows.template_id = zone_rows.template_id
          left join zone_customers on zone_customers.zone_id = zone_rows.zone_id
        ),
        '[]'::jsonb
      ),
      'trucks', (select trucks from truck_options),
      'drivers', (select drivers from driver_options)
    )
  );
end;
$$;

create or replace function public.save_zone_default_template(
  input_zone_id uuid,
  input_truck_id uuid,
  input_driver_id uuid default null,
  input_customer_ids uuid[] default array[]::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
  app_role text := public.current_app_role();
  zone_name text;
  new_template_id uuid;
  customer_ids uuid[] := coalesce(input_customer_ids, array[]::uuid[]);
  stop_count integer := 0;
begin
  if tenant_id is null then
    raise exception 'Operator profile not found';
  end if;

  if app_role not in ('operator_owner', 'operations_supervisor', 'platform_admin') then
    raise exception 'Only operators and supervisors can save ward templates';
  end if;

  select name
  into zone_name
  from public.zones
  where id = input_zone_id
    and operator_id = tenant_id;

  if zone_name is null then
    raise exception 'Ward not found';
  end if;

  if input_truck_id is null
    or not exists (
      select 1
      from public.trucks
      where id = input_truck_id
        and operator_id = tenant_id
        and active
    )
  then
    raise exception 'Select an active truck for this ward template';
  end if;

  if input_driver_id is not null
    and not exists (
      select 1
      from public.staff_members
      where id = input_driver_id
        and operator_id = tenant_id
        and active
        and role = 'driver'
    )
  then
    raise exception 'Selected driver is not available';
  end if;

  if cardinality(customer_ids) = 0 then
    raise exception 'Add at least one customer stop to the ward template';
  end if;

  if exists (
    select 1
    from unnest(customer_ids) as cid(id)
    where not exists (
      select 1
      from public.customers c
      where c.id = cid.id
        and c.operator_id = tenant_id
        and c.zone_id = input_zone_id
        and c.service_status = 'active'
    )
  ) then
    raise exception 'All template stops must be active customers in this ward';
  end if;

  insert into public.route_templates (
    operator_id,
    zone_id,
    kind,
    name,
    truck_id,
    driver_id,
    created_by_staff_id,
    updated_at
  )
  values (
    tenant_id,
    input_zone_id,
    'zone_default',
    zone_name || ' default',
    input_truck_id,
    input_driver_id,
    public.current_staff_member_id(),
    now()
  )
  on conflict (operator_id, zone_id) where (kind = 'zone_default')
  do update set
    truck_id = excluded.truck_id,
    driver_id = excluded.driver_id,
    created_by_staff_id = coalesce(excluded.created_by_staff_id, public.route_templates.created_by_staff_id),
    updated_at = now()
  returning id into new_template_id;

  delete from public.route_template_stops
  where route_template_stops.template_id = new_template_id;

  insert into public.route_template_stops (template_id, customer_id, stop_sequence)
  select
    new_template_id,
    cid.id,
    row_number() over (order by cid.ord)
  from unnest(customer_ids) with ordinality as cid(id, ord);

  select count(*) into stop_count
  from public.route_template_stops
  where route_template_stops.template_id = new_template_id;

  return jsonb_build_object(
    'id', new_template_id,
    'zoneId', input_zone_id,
    'zoneName', zone_name,
    'truckId', input_truck_id,
    'driverId', input_driver_id,
    'stopCount', stop_count
  );
end;
$$;

grant execute on function public.operator_zone_templates_snapshot() to authenticated;
grant execute on function public.save_zone_default_template(uuid, uuid, uuid, uuid[]) to authenticated;
