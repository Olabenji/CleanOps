-- Pin search_path on the SECURITY DEFINER helpers introduced in 0011 and 0013,
-- and add B-tree indexes for hot foreign keys that are not already the
-- leading column of an existing index. truck_live_gps is the 0080 feature;
-- the table that stores route_id is public.truck_live_positions.

alter function public.assert_route_planning_allowed(input_route_id uuid)
  set search_path = public;

alter function public.normalize_route_stop_sequence(input_route_id uuid)
  set search_path = public;

alter function public.assert_admin_master_data_allowed()
  set search_path = public;

alter function public.set_staff_active(input_staff_id uuid, next_active boolean)
  set search_path = public;

alter function public.set_truck_active(input_truck_id uuid, next_active boolean)
  set search_path = public;

do $$
declare
  spec record;
  column_exists boolean;
  leading_index boolean;
begin
  for spec in
    select *
    from (
      values
        ('profiles', 'operator_id', 'profiles_operator_id_idx'),
        ('staff_members', 'profile_id', 'staff_members_profile_id_idx'),
        ('payments', 'customer_id', 'payments_customer_id_idx'),
        ('payments', 'operator_id', 'payments_operator_id_idx'),
        ('routes', 'truck_id', 'routes_truck_id_idx'),
        ('routes', 'driver_id', 'routes_driver_id_idx'),
        ('routes', 'zone_id', 'routes_zone_id_idx'),
        ('customers', 'zone_id', 'customers_zone_id_idx'),
        ('trucks', 'operator_id', 'trucks_operator_id_idx'),
        ('truck_live_positions', 'route_id', 'truck_live_positions_route_id_idx'),
        ('truck_live_gps', 'route_id', 'truck_live_gps_route_id_idx')
    ) as candidates(table_name, column_name, index_name)
  loop
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = spec.table_name
        and column_name = spec.column_name
    )
    into column_exists;

    if not column_exists then
      continue;
    end if;

    select exists (
      select 1
      from pg_index index_row
      join pg_class table_rel on table_rel.oid = index_row.indrelid
      join pg_namespace table_ns on table_ns.oid = table_rel.relnamespace
      join pg_attribute leading_attr
        on leading_attr.attrelid = table_rel.oid
       and leading_attr.attnum = (index_row.indkey::smallint[])[1]
       and not leading_attr.attisdropped
      where table_ns.nspname = 'public'
        and table_rel.relname = spec.table_name
        and leading_attr.attname = spec.column_name
        and index_row.indisvalid
    )
    into leading_index;

    if leading_index then
      continue;
    end if;

    execute format(
      'create index if not exists %I on public.%I (%I)',
      spec.index_name,
      spec.table_name,
      spec.column_name
    );
  end loop;
end
$$;
