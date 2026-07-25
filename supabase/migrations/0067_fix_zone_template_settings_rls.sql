-- Fix Settings zone templates: snapshot could not read template stops under RLS
-- (route_template_stops had RLS enabled with no policies). Use security definer
-- and add tenant read/write policies for templates.

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

drop policy if exists "tenant read route templates" on public.route_templates;
create policy "tenant read route templates"
  on public.route_templates for select
  using (operator_id = public.current_operator_id());

drop policy if exists "managers write route templates" on public.route_templates;
create policy "managers write route templates"
  on public.route_templates for all
  using (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'platform_admin')
  )
  with check (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'platform_admin')
  );

drop policy if exists "tenant read route template stops" on public.route_template_stops;
create policy "tenant read route template stops"
  on public.route_template_stops for select
  using (
    exists (
      select 1
      from public.route_templates
      where route_templates.id = route_template_stops.template_id
        and route_templates.operator_id = public.current_operator_id()
    )
  );

drop policy if exists "managers write route template stops" on public.route_template_stops;
create policy "managers write route template stops"
  on public.route_template_stops for all
  using (
    exists (
      select 1
      from public.route_templates
      where route_templates.id = route_template_stops.template_id
        and route_templates.operator_id = public.current_operator_id()
        and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'platform_admin')
    )
  )
  with check (
    exists (
      select 1
      from public.route_templates
      where route_templates.id = route_template_stops.template_id
        and route_templates.operator_id = public.current_operator_id()
        and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'platform_admin')
    )
  );

grant execute on function public.operator_zone_templates_snapshot() to authenticated;
