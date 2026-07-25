-- Bulk load demo customers into Ward A/B/C and refresh zone_default templates.
-- Counts: A=100, B=120, C=75. Leave 2 bulk customers per ward off the template.
-- Idempotent for this batch via frequency_notes marker 'bulk-demo-v1'.

do $$
declare
  operator_uuid uuid := '00000000-0000-4000-8000-000000000001';
  zone_a uuid := '00000000-0000-4000-8000-000000000101';
  zone_b uuid := '00000000-0000-4000-8000-000000000102';
  zone_c uuid := '00000000-0000-4000-8000-000000000103';
  truck_a uuid := '00000000-0000-4000-8000-000000000301';
  truck_b uuid := '00000000-0000-4000-8000-000000000302';
  truck_c uuid := '00000000-0000-4000-8000-000000000303';
  driver_a uuid := '00000000-0000-4000-8000-000000000201';
  driver_b uuid := '00000000-0000-4000-8000-000000000202';
  driver_c uuid := '00000000-0000-4000-8000-000000000203';
  marker text := 'bulk-demo-v1';
  existing_bulk int;
begin
  select count(*)::int into existing_bulk
  from public.customers
  where operator_id = operator_uuid
    and frequency_notes = marker;

  if existing_bulk > 0 then
    raise notice 'Bulk customers already loaded (%). Rebuilding templates only.', existing_bulk;
  else
    perform setseed(0.42);

    insert into public.customers (
      operator_id,
      zone_id,
      display_name,
      phone,
      address,
      customer_type,
      monthly_rate_kobo,
      service_status,
      current_tag_month,
      collections_per_week,
      preferred_weekdays,
      frequency_notes
    )
    select
      operator_uuid,
      zone_id,
      display_name,
      phone,
      address,
      customer_type,
      monthly_rate_kobo,
      'active'::public.service_status,
      date_trunc('month', current_date)::date,
      cardinality(preferred_weekdays)::smallint,
      preferred_weekdays,
      marker
    from (
      with specs as (
        select zone_a as zone_id, 'A' as ward_code, 100 as qty
        union all select zone_b, 'B', 120
        union all select zone_c, 'C', 75
      ),
      generated as (
        select
          specs.zone_id,
          specs.ward_code,
          gs.n,
          case
            when random() < 0.60 then 'residential'::public.customer_type
            when random() < 0.70 then 'small_business'::public.customer_type
            else 'restaurant'::public.customer_type
          end as customer_type,
          (1 + floor(random() * 7))::int as first_day,
          random() as r2,
          random() as r3
        from specs
        cross join generate_series(1, specs.qty) as gs(n)
      ),
      with_freq as (
        select
          *,
          case
            when customer_type = 'residential' then 1
            when r2 < 0.45 then 1
            when r2 < 0.80 then 2
            else 3
          end as day_count
        from generated
      )
      select
        zone_id,
        case
          when customer_type = 'residential' then
            format(
              '%s %s %s-%s',
              (array['Mr.', 'Mrs.', 'Miss', 'Chief', 'Alhaji', 'Dr.'])[1 + floor(r3 * 6)::int],
              (array[
                'Adeyemi','Okoro','Balogun','Ibrahim','Okafor','Bello','Eze','Nwosu',
                'Adebayo','Lawal','Ogunleye','Chukwu','Fashola','Danladi','Onyeka','Salami'
              ])[1 + floor(r2 * 16)::int],
              ward_code,
              lpad(n::text, 3, '0')
            )
          when customer_type = 'restaurant' then
            format(
              '%s %s-%s',
              (array[
                'Kitchen Corner','Suya Spot','Mama Put','City Grill','Pepper Soup Place',
                'Lagos Bites','Amala House','Fisherman Pot','Bread & Beans','Chop Box'
              ])[1 + floor(r3 * 10)::int],
              ward_code,
              lpad(n::text, 3, '0')
            )
          else
            format(
              '%s %s-%s',
              (array[
                'Mini Mart','Pharmacy','Salon','Boutique','Cyber Cafe','Bakery',
                'Phone Hub','Laundry','Provision Store','Hardware Store'
              ])[1 + floor(r3 * 10)::int],
              ward_code,
              lpad(n::text, 3, '0')
            )
        end as display_name,
        format('+23480%s', lpad(((ascii(ward_code) * 1000) + n)::text, 8, '0')) as phone,
        format(
          '%s %s, Surulere Ward %s',
          (10 + floor(r2 * 90))::int,
          (array[
            'Akinwunmi Street','Market Road','Adeniran Ogunsanya','Bode Thomas',
            'Ogunlana Drive','Ishaga Road','Randle Avenue','Eric Moore',
            'Tejuosho Street','Akerele Street'
          ])[1 + floor(r3 * 10)::int],
          ward_code
        ) as address,
        customer_type,
        case customer_type
          when 'residential' then (400000 + floor(r2 * 3000) * 100)::int
          when 'restaurant' then (1500000 + floor(r2 * 2000000))::int
          else (800000 + floor(r2 * 1200000))::int
        end as monthly_rate_kobo,
        (
          select array_agg(d order by d)::smallint[]
          from (
            select distinct ((first_day - 1 + day_offset) % 7 + 1)::smallint as d
            from generate_series(0, day_count - 1) as day_offset
          ) days
        ) as preferred_weekdays
      from with_freq
    ) payload;

    raise notice 'Inserted bulk customers for Wards A/B/C';
  end if;

  insert into public.route_templates (
    operator_id, zone_id, kind, name, truck_id, driver_id, updated_at
  )
  values
    (operator_uuid, zone_a, 'zone_default', 'Ward A default', truck_a, driver_a, now()),
    (operator_uuid, zone_b, 'zone_default', 'Ward B default', truck_b, driver_b, now()),
    (operator_uuid, zone_c, 'zone_default', 'Ward C default', truck_c, driver_c, now())
  on conflict (operator_id, zone_id) where (kind = 'zone_default')
  do update set
    truck_id = excluded.truck_id,
    driver_id = excluded.driver_id,
    name = excluded.name,
    updated_at = now();

  delete from public.route_template_stops rts
  using public.route_templates rt
  where rts.template_id = rt.id
    and rt.operator_id = operator_uuid
    and rt.kind = 'zone_default';

  insert into public.route_template_stops (template_id, customer_id, stop_sequence)
  select
    rt.id,
    c.id,
    row_number() over (partition by rt.id order by c.display_name, c.id)::int
  from public.route_templates rt
  join public.customers c
    on c.zone_id = rt.zone_id
   and c.operator_id = rt.operator_id
   and c.service_status = 'active'
  where rt.operator_id = operator_uuid
    and rt.kind = 'zone_default'
    and c.id not in (
      select excluded.id
      from (
        select
          customers.id,
          row_number() over (
            partition by customers.zone_id
            order by customers.display_name desc, customers.id desc
          ) as rn
        from public.customers
        where customers.operator_id = operator_uuid
          and customers.frequency_notes = marker
          and customers.service_status = 'active'
      ) excluded
      where excluded.rn <= 2
    );

  raise notice 'Template rebuild complete';
end
$$;

select
  z.name as ward,
  count(c.*) filter (where c.frequency_notes = 'bulk-demo-v1') as bulk_customers,
  count(c.*) as total_customers,
  count(c.*) filter (
    where c.frequency_notes = 'bulk-demo-v1'
      and c.customer_type = 'residential'
  ) as bulk_residential,
  count(c.*) filter (
    where c.frequency_notes = 'bulk-demo-v1'
      and c.customer_type <> 'residential'
  ) as bulk_commercial,
  (
    select count(*)
    from public.route_template_stops rts
    join public.route_templates rt on rt.id = rts.template_id
    where rt.zone_id = z.id
      and rt.kind = 'zone_default'
  ) as template_stops,
  (
    select count(*)
    from public.customers cx
    where cx.zone_id = z.id
      and cx.operator_id = z.operator_id
      and cx.service_status = 'active'
      and not exists (
        select 1
        from public.route_template_stops rts
        join public.route_templates rt on rt.id = rts.template_id
        where rts.customer_id = cx.id
          and rt.kind = 'zone_default'
      )
  ) as active_off_template
from public.zones z
left join public.customers c on c.zone_id = z.id
where z.operator_id = '00000000-0000-4000-8000-000000000001'
group by z.id, z.name, z.operator_id
order by z.name;
