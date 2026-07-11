-- Sprint 8: operator Admin can edit existing staff, trucks, and customers.

create or replace function public.update_staff_member(
  input_staff_id uuid,
  input_full_name text,
  input_phone text,
  input_role public.app_role,
  input_monthly_salary_kobo integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
  staff_record public.staff_members%rowtype;
begin
  if input_role not in (
    'driver',
    'loader',
    'collection_agent',
    'operations_supervisor'
  ) then
    raise exception 'Staff role must be driver, loader, collection agent, or operations supervisor';
  end if;

  select *
  into staff_record
  from public.staff_members
  where id = input_staff_id
    and operator_id = tenant_id;

  if not found then
    raise exception 'Staff member not found';
  end if;

  if exists (
    select 1
    from public.staff_members
    where operator_id = tenant_id
      and phone = trim(input_phone)
      and id <> input_staff_id
  ) then
    raise exception 'A staff member with this phone already exists';
  end if;

  update public.staff_members
  set
    full_name = trim(input_full_name),
    phone = trim(input_phone),
    role = input_role,
    monthly_salary_kobo = greatest(input_monthly_salary_kobo, 0)
  where id = input_staff_id;

  if staff_record.profile_id is not null then
    update public.profiles
    set
      full_name = trim(input_full_name),
      phone = trim(input_phone),
      role = input_role
    where id = staff_record.profile_id
      and operator_id = tenant_id;
  end if;
end;
$$;

create or replace function public.update_truck(
  input_truck_id uuid,
  input_zone_id uuid,
  input_registration_number text,
  input_make text default null,
  input_model text default null,
  input_year integer default null,
  input_status public.truck_status default 'operational'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
begin
  if not exists (
    select 1
    from public.trucks
    where id = input_truck_id
      and operator_id = tenant_id
  ) then
    raise exception 'Truck not found';
  end if;

  if input_zone_id is not null and not exists (
    select 1 from public.zones where id = input_zone_id and operator_id = tenant_id
  ) then
    raise exception 'Zone not found';
  end if;

  if exists (
    select 1
    from public.trucks
    where operator_id = tenant_id
      and upper(registration_number) = upper(trim(input_registration_number))
      and id <> input_truck_id
  ) then
    raise exception 'A truck with this registration already exists';
  end if;

  update public.trucks
  set
    zone_id = input_zone_id,
    registration_number = upper(trim(input_registration_number)),
    make = nullif(trim(coalesce(input_make, '')), ''),
    model = nullif(trim(coalesce(input_model, '')), ''),
    year = input_year,
    status = input_status
  where id = input_truck_id;
end;
$$;

create or replace function public.update_customer(
  input_customer_id uuid,
  input_zone_id uuid,
  input_display_name text,
  input_phone text,
  input_address text,
  input_customer_type public.customer_type,
  input_monthly_rate_kobo integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
  current_zone_id uuid;
  normalized_phone text := nullif(trim(coalesce(input_phone, '')), '');
begin
  select zone_id
  into current_zone_id
  from public.customers
  where id = input_customer_id
    and operator_id = tenant_id;

  if current_zone_id is null then
    raise exception 'Customer not found';
  end if;

  if not exists (
    select 1 from public.zones where id = input_zone_id and operator_id = tenant_id
  ) then
    raise exception 'Zone not found';
  end if;

  if normalized_phone is not null and exists (
    select 1
    from public.customers
    where operator_id = tenant_id
      and phone = normalized_phone
      and id <> input_customer_id
  ) then
    raise exception 'A customer with this phone already exists';
  end if;

  if input_zone_id <> current_zone_id then
    if exists (
      select 1
      from public.route_stops
      join public.routes on routes.id = route_stops.route_id
      where route_stops.customer_id = input_customer_id
        and routes.operator_id = tenant_id
        and routes.status = 'in_progress'
        and routes.zone_id <> input_zone_id
    ) then
      raise exception 'Cannot move customer while they are on an in-progress route. Finish or reassign the stop first.';
    end if;

    delete from public.route_stops
    using public.routes
    where route_stops.route_id = routes.id
      and route_stops.customer_id = input_customer_id
      and routes.operator_id = tenant_id
      and routes.zone_id <> input_zone_id
      and routes.status = 'scheduled';

    delete from public.route_template_stops
    using public.route_templates
    where route_template_stops.template_id = route_templates.id
      and route_template_stops.customer_id = input_customer_id
      and route_templates.operator_id = tenant_id
      and route_templates.zone_id <> input_zone_id;
  end if;

  update public.customers
  set
    zone_id = input_zone_id,
    display_name = trim(input_display_name),
    phone = normalized_phone,
    address = trim(input_address),
    customer_type = input_customer_type,
    monthly_rate_kobo = greatest(input_monthly_rate_kobo, 0)
  where id = input_customer_id;
end;
$$;

comment on function public.update_staff_member is
  'Admin: update staff identity, role, and salary. Login email stays on provision/reset flows.';

comment on function public.update_truck is
  'Admin: update truck registration, home zone, vehicle details, and fleet status.';

comment on function public.update_customer is
  'Admin: update customer account details. Zone moves drop mismatched scheduled stops and template stops.';
