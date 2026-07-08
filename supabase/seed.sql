insert into public.operators (id, name, lawma_reference, primary_contact_phone)
values (
  '00000000-0000-4000-8000-000000000001',
  'Next to Godliness Ventures',
  'LAWMA-PSP-SURULERE-007',
  '+2348000000001'
)
on conflict (id) do nothing;

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  phone,
  encrypted_password,
  email_confirmed_at,
  phone_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  phone_change_token,
  phone_change,
  email_change_token_current,
  reauthentication_token
)
values (
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'owner@cleanops.local',
  '+2348000000011',
  crypt('cleanops-demo-password', gen_salt('bf')),
  now(),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Lanre Operator"}'::jsonb,
  false,
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ''
)
on conflict (id) do nothing;

insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000011',
  '{"sub":"00000000-0000-4000-8000-000000000011","email":"owner@cleanops.local","email_verified":true,"phone_verified":true}'::jsonb,
  'email',
  now(),
  now(),
  now()
)
on conflict (provider_id, provider) do nothing;

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  phone,
  encrypted_password,
  email_confirmed_at,
  phone_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  phone_change_token,
  phone_change,
  email_change_token_current,
  reauthentication_token
)
values (
  '00000000-0000-4000-8000-000000000021',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'driver@cleanops.local',
  '+2348000000201',
  crypt('cleanops-driver-password', gen_salt('bf')),
  now(),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Adewale Johnson"}'::jsonb,
  false,
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ''
)
on conflict (id) do nothing;

insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-000000000022',
  '00000000-0000-4000-8000-000000000021',
  '00000000-0000-4000-8000-000000000021',
  '{"sub":"00000000-0000-4000-8000-000000000021","email":"driver@cleanops.local","email_verified":true,"phone_verified":true}'::jsonb,
  'email',
  now(),
  now(),
  now()
)
on conflict (provider_id, provider) do nothing;

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  phone,
  encrypted_password,
  email_confirmed_at,
  phone_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  phone_change_token,
  phone_change,
  email_change_token_current,
  reauthentication_token
)
values (
  '00000000-0000-4000-8000-000000000031',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'agent@cleanops.local',
  '+2348000000205',
  crypt('cleanops-agent-password', gen_salt('bf')),
  now(),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Kunle Martins"}'::jsonb,
  false,
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ''
)
on conflict (id) do nothing;

insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-000000000032',
  '00000000-0000-4000-8000-000000000031',
  '00000000-0000-4000-8000-000000000031',
  '{"sub":"00000000-0000-4000-8000-000000000031","email":"agent@cleanops.local","email_verified":true,"phone_verified":true}'::jsonb,
  'email',
  now(),
  now(),
  now()
)
on conflict (provider_id, provider) do nothing;

insert into public.profiles (
  id,
  operator_id,
  role,
  full_name,
  phone
)
values (
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000001',
  'operator_owner',
  'Lanre Operator',
  '+2348000000011'
)
on conflict (id) do nothing;

insert into public.profiles (
  id,
  operator_id,
  role,
  full_name,
  phone
)
values (
  '00000000-0000-4000-8000-000000000031',
  '00000000-0000-4000-8000-000000000001',
  'collection_agent',
  'Kunle Martins',
  '+2348000000205'
)
on conflict (id) do nothing;

insert into public.profiles (
  id,
  operator_id,
  role,
  full_name,
  phone
)
values (
  '00000000-0000-4000-8000-000000000021',
  '00000000-0000-4000-8000-000000000001',
  'driver',
  'Adewale Johnson',
  '+2348000000201'
)
on conflict (id) do nothing;

insert into public.profiles (
  id,
  operator_id,
  role,
  full_name,
  phone
)
values (
  '00000000-0000-4000-8000-000000000031',
  '00000000-0000-4000-8000-000000000001',
  'collection_agent',
  'Kunle Martins',
  '+2348000000205'
)
on conflict (id) do nothing;

insert into public.zones (id, operator_id, name, description)
values
  (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    'Zone A',
    'Ward 7 northern route'
  ),
  (
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000001',
    'Zone B',
    'Ward 7 central route'
  ),
  (
    '00000000-0000-4000-8000-000000000103',
    '00000000-0000-4000-8000-000000000001',
    'Zone C',
    'Ward 7 southern route'
  )
on conflict (operator_id, name) do nothing;

insert into public.staff_members (
  id,
  operator_id,
  full_name,
  phone,
  role,
  monthly_salary_kobo,
  active
)
values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', 'Adewale Johnson', '+2348000000201', 'driver', 18000000, true),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000001', 'Chinedu Okafor', '+2348000000202', 'driver', 18000000, true),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000001', 'Musa Balogun', '+2348000000203', 'driver', 18000000, true),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000001', 'Grace Edet', '+2348000000204', 'operations_supervisor', 25000000, true),
  ('00000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-000000000001', 'Kunle Martins', '+2348000000205', 'collection_agent', 14000000, true),
  ('00000000-0000-4000-8000-000000000206', '00000000-0000-4000-8000-000000000001', 'Blessing Nwosu', '+2348000000206', 'collection_agent', 14000000, true),
  ('00000000-0000-4000-8000-000000000207', '00000000-0000-4000-8000-000000000001', 'Samuel Ibitoye', '+2348000000207', 'driver', 18000000, true),
  ('00000000-0000-4000-8000-000000000208', '00000000-0000-4000-8000-000000000001', 'Loader Team A1', '+2348000000208', 'driver', 9000000, true),
  ('00000000-0000-4000-8000-000000000209', '00000000-0000-4000-8000-000000000001', 'Loader Team A2', '+2348000000209', 'driver', 9000000, true),
  ('00000000-0000-4000-8000-000000000210', '00000000-0000-4000-8000-000000000001', 'Loader Team B1', '+2348000000210', 'driver', 9000000, true),
  ('00000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-000000000001', 'Loader Team B2', '+2348000000211', 'driver', 9000000, true),
  ('00000000-0000-4000-8000-000000000212', '00000000-0000-4000-8000-000000000001', 'Loader Team C1', '+2348000000212', 'driver', 9000000, true),
  ('00000000-0000-4000-8000-000000000213', '00000000-0000-4000-8000-000000000001', 'Loader Team C2', '+2348000000213', 'driver', 9000000, true),
  ('00000000-0000-4000-8000-000000000214', '00000000-0000-4000-8000-000000000001', 'Fleet Officer', '+2348000000214', 'operations_supervisor', 17000000, true),
  ('00000000-0000-4000-8000-000000000215', '00000000-0000-4000-8000-000000000001', 'Admin Officer', '+2348000000215', 'operations_supervisor', 16000000, true),
  ('00000000-0000-4000-8000-000000000216', '00000000-0000-4000-8000-000000000001', 'Relief Loader', '+2348000000216', 'driver', 8500000, true)
on conflict (id) do nothing;

update public.staff_members
set profile_id = '00000000-0000-4000-8000-000000000021',
    login_email = 'driver@cleanops.local'
where id = '00000000-0000-4000-8000-000000000201';

update public.staff_members
set profile_id = '00000000-0000-4000-8000-000000000031',
    login_email = 'agent@cleanops.local'
where id = '00000000-0000-4000-8000-000000000205';

insert into public.trucks (
  id,
  operator_id,
  zone_id,
  registration_number,
  make,
  model,
  year,
  current_driver_id,
  odometer_km,
  status
)
values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'LAG-001-PSP', 'Mack', 'Granite', 2018, '00000000-0000-4000-8000-000000000201', 84200, 'operational'),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', 'LAG-002-PSP', 'Isuzu', 'FVR', 2019, '00000000-0000-4000-8000-000000000202', 77650, 'operational'),
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000103', 'LAG-003-PSP', 'Mercedes-Benz', 'Atego', 2020, '00000000-0000-4000-8000-000000000203', 69410, 'standby')
on conflict (operator_id, registration_number) do nothing;

insert into public.customers (
  id,
  operator_id,
  zone_id,
  display_name,
  phone,
  address,
  customer_type,
  monthly_rate_kobo,
  service_status,
  current_tag_month,
  suspension_reason
)
values
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'Mrs. Folake Adebayo', '+2348000000401', '14 Akinwunmi Street, Surulere', 'residential', 500000, 'active', date_trunc('month', current_date)::date, null),
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'Mr. Tunde Lawal', '+2348000000402', '16 Akinwunmi Street, Surulere', 'residential', 500000, 'active', date_trunc('month', current_date)::date, null),
  ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', 'Tasty Bites Eatery', '+2348000000403', '22 Market Road, Surulere', 'restaurant', 2500000, 'active', date_trunc('month', current_date)::date, null),
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', 'Blue Gate Mini Mart', '+2348000000404', '25 Market Road, Surulere', 'small_business', 1500000, 'suspended', null, 'Outstanding monthly balance unpaid'),
  ('00000000-0000-4000-8000-000000000405', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000103', 'Block C Residents Association', '+2348000000405', 'Block C Estate, Surulere', 'estate', 7500000, 'active', date_trunc('month', current_date)::date, null)
on conflict (id) do nothing;

insert into public.routes (
  id,
  operator_id,
  zone_id,
  truck_id,
  driver_id,
  scheduled_date,
  status,
  started_at
)
values
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', current_date, 'in_progress', now() - interval '3 hours'),
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000202', current_date, 'in_progress', now() - interval '2 hours'),
  ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000203', current_date, 'scheduled', null)
on conflict (id) do nothing;

insert into public.route_stops (route_id, customer_id, stop_sequence, status, completed_at)
values
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000401', 1, 'completed', now() - interval '2 hours'),
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000402', 2, 'completed', now() - interval '90 minutes'),
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000403', 3, 'pending', null),
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000404', 4, 'pending', null),
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000405', 5, 'pending', null),
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000403', 1, 'completed', now() - interval '75 minutes'),
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000404', 2, 'skipped', null),
  ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000405', 1, 'pending', null)
on conflict (route_id, customer_id) do nothing;

insert into public.payments (
  id,
  operator_id,
  customer_id,
  collected_by_staff_id,
  channel,
  amount_kobo,
  external_reference,
  idempotency_key,
  paid_at
)
values
  ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000401', null, 'paystack', 500000, 'PSK_DEMO_001', 'seed:payment:001', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000403', null, 'bank_transfer', 2500000, 'TRF_DEMO_001', 'seed:payment:002', now() - interval '2 hours'),
  ('00000000-0000-4000-8000-000000000603', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000405', '00000000-0000-4000-8000-000000000205', 'agent_cash', 7500000, 'CASH_DEMO_001', 'seed:payment:003', now() - interval '3 hours')
on conflict (operator_id, idempotency_key) do nothing;

insert into public.attendance_logs (operator_id, staff_member_id, checked_in_at, supervisor_override, notes)
select
  '00000000-0000-4000-8000-000000000001',
  staff_members.id,
  now() - interval '4 hours',
  false,
  'Seed check-in'
from public.staff_members
where staff_members.operator_id = '00000000-0000-4000-8000-000000000001'
  and staff_members.id not in (
    '00000000-0000-4000-8000-000000000215',
    '00000000-0000-4000-8000-000000000216'
  )
  and not exists (
    select 1
    from public.attendance_logs
    where attendance_logs.staff_member_id = staff_members.id
      and attendance_logs.checked_in_at::date = current_date
  );

insert into public.maintenance_events (
  id,
  operator_id,
  truck_id,
  event_date,
  work_done,
  workshop_name,
  cost_kobo
)
values
  ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000301', current_date - 12, 'Brake inspection and oil top-up', 'Surulere Fleet Works', 5500000),
  ('00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000302', current_date - 5, 'Hydraulic hose replacement', 'Ojuelegba Truck Service', 10200000)
on conflict (id) do nothing;

insert into public.incident_reports (
  id,
  operator_id,
  route_id,
  truck_id,
  reported_by_staff_id,
  title,
  description
)
values
  (
    '00000000-0000-4000-8000-000000000801',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000502',
    '00000000-0000-4000-8000-000000000302',
    '00000000-0000-4000-8000-000000000202',
    'Zone B running behind expected pace',
    'Traffic delay around Market Road has slowed stop completion.'
  )
on conflict (id) do nothing;
