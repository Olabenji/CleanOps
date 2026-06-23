create extension if not exists "pgcrypto";
create extension if not exists "postgis";

create type public.app_role as enum (
  'operator_owner',
  'operations_supervisor',
  'driver',
  'collection_agent',
  'resident',
  'platform_admin'
);

create type public.customer_type as enum (
  'residential',
  'small_business',
  'restaurant',
  'estate'
);

create type public.service_status as enum (
  'active',
  'suspended'
);

create type public.route_status as enum (
  'scheduled',
  'in_progress',
  'completed',
  'cancelled'
);

create type public.route_stop_status as enum (
  'pending',
  'completed',
  'skipped',
  'missed_reported'
);

create type public.payment_channel as enum (
  'paystack',
  'bank_transfer',
  'opay',
  'palmpay',
  'moniepoint',
  'agent_cash'
);

create table public.operators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lawma_reference text,
  primary_contact_phone text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  operator_id uuid references public.operators(id) on delete cascade,
  role public.app_role not null,
  full_name text not null,
  phone text not null,
  created_at timestamptz not null default now(),
  constraint platform_admin_operator_check check (
    role != 'platform_admin' or operator_id is null
  )
);

create table public.zones (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (operator_id, name)
);

create table public.staff_members (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  full_name text not null,
  phone text not null,
  role public.app_role not null,
  monthly_salary_kobo integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.trucks (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  zone_id uuid references public.zones(id) on delete set null,
  registration_number text not null,
  make text,
  model text,
  year integer,
  current_driver_id uuid references public.staff_members(id) on delete set null,
  odometer_km integer not null default 0,
  monthly_maintenance_reserve_kobo integer not null default 20000000,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (operator_id, registration_number)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  zone_id uuid not null references public.zones(id) on delete restrict,
  display_name text not null,
  phone text,
  email text,
  address text not null,
  location geography(point, 4326),
  customer_type public.customer_type not null default 'residential',
  monthly_rate_kobo integer not null,
  service_status public.service_status not null default 'active',
  current_tag_month date,
  created_at timestamptz not null default now()
);

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  zone_id uuid not null references public.zones(id) on delete restrict,
  truck_id uuid not null references public.trucks(id) on delete restrict,
  driver_id uuid references public.staff_members(id) on delete set null,
  scheduled_date date not null,
  status public.route_status not null default 'scheduled',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.route_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  stop_sequence integer not null,
  status public.route_stop_status not null default 'pending',
  completed_at timestamptz,
  notes text,
  location geography(point, 4326),
  unique (route_id, stop_sequence),
  unique (route_id, customer_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  collected_by_staff_id uuid references public.staff_members(id) on delete set null,
  channel public.payment_channel not null,
  amount_kobo integer not null check (amount_kobo > 0),
  external_reference text,
  idempotency_key text not null,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (operator_id, idempotency_key)
);

create table public.attendance_logs (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  check_in_location geography(point, 4326),
  supervisor_override boolean not null default false,
  notes text
);

create table public.maintenance_events (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  truck_id uuid not null references public.trucks(id) on delete cascade,
  event_date date not null,
  work_done text not null,
  workshop_name text,
  cost_kobo integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.incident_reports (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  route_id uuid references public.routes(id) on delete set null,
  truck_id uuid references public.trucks(id) on delete set null,
  reported_by_staff_id uuid references public.staff_members(id) on delete set null,
  title text not null,
  description text not null,
  location geography(point, 4326),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.current_operator_id()
returns uuid
language sql
stable
as $$
  select operator_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

alter table public.operators enable row level security;
alter table public.profiles enable row level security;
alter table public.zones enable row level security;
alter table public.staff_members enable row level security;
alter table public.trucks enable row level security;
alter table public.customers enable row level security;
alter table public.routes enable row level security;
alter table public.route_stops enable row level security;
alter table public.payments enable row level security;
alter table public.attendance_logs enable row level security;
alter table public.maintenance_events enable row level security;
alter table public.incident_reports enable row level security;

create policy "profiles can read own tenant profiles"
  on public.profiles for select
  using (id = auth.uid() or operator_id = public.current_operator_id());

create policy "tenant members can read operators"
  on public.operators for select
  using (id = public.current_operator_id() or public.current_app_role() = 'platform_admin');

create policy "tenant read zones"
  on public.zones for select
  using (operator_id = public.current_operator_id());

create policy "tenant read staff"
  on public.staff_members for select
  using (operator_id = public.current_operator_id());

create policy "tenant read trucks"
  on public.trucks for select
  using (operator_id = public.current_operator_id());

create policy "tenant read customers"
  on public.customers for select
  using (operator_id = public.current_operator_id());

create policy "tenant read routes"
  on public.routes for select
  using (operator_id = public.current_operator_id());

create policy "tenant read route stops"
  on public.route_stops for select
  using (
    exists (
      select 1 from public.routes
      where routes.id = route_stops.route_id
      and routes.operator_id = public.current_operator_id()
    )
  );

create policy "tenant read payments"
  on public.payments for select
  using (operator_id = public.current_operator_id());

create policy "tenant read attendance"
  on public.attendance_logs for select
  using (operator_id = public.current_operator_id());

create policy "tenant read maintenance"
  on public.maintenance_events for select
  using (operator_id = public.current_operator_id());

create policy "tenant read incidents"
  on public.incident_reports for select
  using (operator_id = public.current_operator_id());
