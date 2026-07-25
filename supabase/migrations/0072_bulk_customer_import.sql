-- Bulk customer import for PSP operators (Settings → Customer data load).
-- Idempotency: skip rows whose phone already exists for current_operator_id().
-- Rates are always passed as kobo. Optional append to ward zone_default templates.

create or replace function public.import_customers_bulk(
  input_rows jsonb,
  input_add_to_zone_templates boolean default false,
  input_import_marker text default 'bulk-import'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
  app_role text := public.current_app_role();
  marker text := nullif(trim(coalesce(input_import_marker, 'bulk-import')), '');
  row_json jsonb;
  row_number integer;
  display_name text;
  phone_raw text;
  phone_norm text;
  address_text text;
  ward_name text;
  zone_id uuid;
  customer_type public.customer_type;
  monthly_rate_kobo integer;
  collections_per_week smallint;
  preferred_weekdays smallint[];
  weekdays smallint[];
  freq smallint;
  new_id uuid;
  inserted_count integer := 0;
  skipped_count integer := 0;
  template_appended integer := 0;
  error_rows jsonb := '[]'::jsonb;
  inserted_ids uuid[] := array[]::uuid[];
  batch_phones text[] := array[]::text[];
  zone_template_id uuid;
  max_seq integer;
  zone_rec record;
begin
  if tenant_id is null then
    raise exception 'Operator profile not found';
  end if;

  if app_role not in ('operator_owner', 'operations_supervisor', 'platform_admin') then
    raise exception 'Only operators and supervisors can import customers';
  end if;

  if marker is null then
    marker := 'bulk-import';
  end if;

  if input_rows is null or jsonb_typeof(input_rows) <> 'array' then
    raise exception 'Import rows must be a JSON array';
  end if;

  if jsonb_array_length(input_rows) < 1 then
    raise exception 'Import at least one customer row';
  end if;

  if jsonb_array_length(input_rows) > 500 then
    raise exception 'Import is limited to 500 rows per batch';
  end if;

  for row_json in
    select value
    from jsonb_array_elements(input_rows) as t(value)
  loop
    begin
      row_number := coalesce((row_json ->> 'rowNumber')::integer, 0);
      display_name := trim(coalesce(row_json ->> 'displayName', ''));
      phone_raw := nullif(trim(coalesce(row_json ->> 'phone', '')), '');
      phone_norm := phone_raw;
      address_text := trim(coalesce(row_json ->> 'address', ''));
      ward_name := trim(coalesce(row_json ->> 'wardName', ''));
      customer_type := (row_json ->> 'customerType')::public.customer_type;
      monthly_rate_kobo := greatest(coalesce((row_json ->> 'monthlyRateKobo')::integer, 0), 0);
      collections_per_week := least(
        greatest(coalesce((row_json ->> 'collectionsPerWeek')::smallint, 1), 1),
        7
      );

      select coalesce(array_agg(distinct d order by d), array[]::smallint[])
      into preferred_weekdays
      from jsonb_array_elements_text(coalesce(row_json -> 'preferredWeekdays', '[]'::jsonb)) as t(v)
      cross join lateral (select (t.v)::smallint as d) x
      where x.d between 1 and 7;

      weekdays := preferred_weekdays;
      freq := collections_per_week;

      if display_name = '' or char_length(display_name) < 2 then
        raise exception 'Display name is required';
      end if;

      if address_text = '' or char_length(address_text) < 5 then
        raise exception 'Address is required';
      end if;

      if ward_name = '' then
        raise exception 'Ward name is required';
      end if;

      if cardinality(weekdays) < 1 then
        raise exception 'Select at least one preferred weekday';
      end if;

      -- Match ward by case-insensitive name, then "Ward X" soft match.
      select zones.id
      into zone_id
      from public.zones
      where zones.operator_id = tenant_id
        and lower(zones.name) = lower(ward_name)
      limit 1;

      if zone_id is null then
        select zones.id
        into zone_id
        from public.zones
        where zones.operator_id = tenant_id
          and (
            lower(zones.name) = lower('Ward ' || ward_name)
            or lower(regexp_replace(zones.name, '^ward\s+', '', 'i')) = lower(ward_name)
          )
        limit 1;
      end if;

      if zone_id is null then
        raise exception 'Ward "%" not found', ward_name;
      end if;

      -- Idempotency: skip duplicate phone within operator (and within this batch).
      if phone_norm is not null then
        if phone_norm = any (batch_phones) then
          skipped_count := skipped_count + 1;
          continue;
        end if;

        if exists (
          select 1
          from public.customers
          where customers.operator_id = tenant_id
            and customers.phone = phone_norm
        ) then
          skipped_count := skipped_count + 1;
          batch_phones := array_append(batch_phones, phone_norm);
          continue;
        end if;

        batch_phones := array_append(batch_phones, phone_norm);
      end if;

      insert into public.customers (
        operator_id,
        zone_id,
        display_name,
        phone,
        address,
        customer_type,
        monthly_rate_kobo,
        service_status,
        suspension_reason,
        current_tag_month,
        collections_per_week,
        preferred_weekdays,
        frequency_notes
      )
      values (
        tenant_id,
        zone_id,
        display_name,
        phone_norm,
        address_text,
        customer_type,
        monthly_rate_kobo,
        'active'::public.service_status,
        null,
        date_trunc('month', current_date)::date,
        freq,
        weekdays,
        coalesce(nullif(trim(coalesce(row_json ->> 'frequencyNotes', '')), ''), marker)
      )
      returning id into new_id;

      inserted_count := inserted_count + 1;
      inserted_ids := array_append(inserted_ids, new_id);
    exception
      when others then
        error_rows := error_rows || jsonb_build_array(
          jsonb_build_object(
            'rowNumber', greatest(row_number, 1),
            'message', SQLERRM
          )
        );
    end;
  end loop;

  if input_add_to_zone_templates and cardinality(inserted_ids) > 0 then
    perform public.ensure_zone_default_templates(tenant_id);

    for zone_rec in
      select
        c.zone_id,
        array_agg(c.id order by c.display_name) as customer_ids
      from public.customers c
      where c.id = any (inserted_ids)
        and c.operator_id = tenant_id
        and c.service_status = 'active'
      group by c.zone_id
    loop
      select templates.id
      into zone_template_id
      from public.route_templates templates
      where templates.operator_id = tenant_id
        and templates.zone_id = zone_rec.zone_id
        and templates.kind = 'zone_default'
      limit 1;

      if zone_template_id is null then
        continue;
      end if;

      -- Only append when the template already has a truck (otherwise leave for Settings editor).
      if not exists (
        select 1
        from public.route_templates templates
        where templates.id = zone_template_id
          and templates.truck_id is not null
      ) then
        continue;
      end if;

      select coalesce(max(rts.stop_sequence), 0)
      into max_seq
      from public.route_template_stops rts
      where rts.template_id = zone_template_id;

      with to_add as (
        select
          cid,
          max_seq + row_number() over (order by cid) as stop_sequence
        from unnest(zone_rec.customer_ids) as cid
        where not exists (
          select 1
          from public.route_template_stops existing
          where existing.template_id = zone_template_id
            and existing.customer_id = cid
        )
      ),
      inserted as (
        insert into public.route_template_stops (template_id, customer_id, stop_sequence)
        select zone_template_id, to_add.cid, to_add.stop_sequence
        from to_add
        returning 1
      )
      select coalesce((select count(*)::integer from inserted), 0)
      into max_seq;

      template_appended := template_appended + coalesce(max_seq, 0);

      if coalesce(max_seq, 0) > 0 then
        update public.route_templates
        set updated_at = now()
        where id = zone_template_id;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'inserted', inserted_count,
    'skippedDuplicates', skipped_count,
    'templateAppended', template_appended,
    'errors', error_rows,
    'insertedCustomerIds', to_jsonb(inserted_ids)
  );
end;
$$;

comment on function public.import_customers_bulk(jsonb, boolean, text) is
  'Bulk-import customers for current_operator_id(). Skips existing phones. Rates in kobo. Optional ward template append.';

grant execute on function public.import_customers_bulk(jsonb, boolean, text) to authenticated;
