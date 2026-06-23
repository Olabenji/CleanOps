create table public.absence_logs (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,
  absence_date date not null,
  reason text not null,
  recorded_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (staff_member_id, absence_date)
);

alter table public.absence_logs enable row level security;

create policy "tenant read absences"
  on public.absence_logs for select
  using (operator_id = public.current_operator_id());

create policy "operator managers write absences"
  on public.absence_logs for all
  using (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor')
  )
  with check (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor')
  );

create policy "operator managers update attendance"
  on public.attendance_logs for update
  using (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor')
  )
  with check (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor')
  );

create or replace function public.attendance_snapshot(input_date date default current_date)
returns jsonb
language sql
stable
security invoker
as $$
  with attendance_for_day as (
    select distinct on (attendance_logs.staff_member_id)
      attendance_logs.staff_member_id,
      attendance_logs.checked_in_at,
      attendance_logs.supervisor_override,
      attendance_logs.notes
    from public.attendance_logs
    where attendance_logs.operator_id = public.current_operator_id()
      and attendance_logs.checked_in_at::date = input_date
    order by attendance_logs.staff_member_id, attendance_logs.checked_in_at asc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'staffMemberId', staff_members.id,
        'fullName', staff_members.full_name,
        'phone', staff_members.phone,
        'role', staff_members.role,
        'monthlySalaryKobo', staff_members.monthly_salary_kobo,
        'checkedInAt', attendance_for_day.checked_in_at,
        'supervisorOverride', coalesce(attendance_for_day.supervisor_override, false),
        'status', case when attendance_for_day.checked_in_at is null then 'absent' else 'checked_in' end,
        'absenceReason', absence_logs.reason,
        'attendanceNote', attendance_for_day.notes
      )
      order by staff_members.full_name
    ),
    '[]'::jsonb
  )
  from public.staff_members
  left join attendance_for_day on attendance_for_day.staff_member_id = staff_members.id
  left join public.absence_logs
    on absence_logs.staff_member_id = staff_members.id
    and absence_logs.absence_date = input_date
  where staff_members.operator_id = public.current_operator_id()
    and staff_members.active;
$$;

create or replace function public.record_attendance_override(
  input_staff_member_id uuid,
  input_attendance_date date,
  input_checked_in boolean,
  input_reason text default null,
  input_note text default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  tenant_id uuid;
  attendance_id uuid;
begin
  select operator_id
  into tenant_id
  from public.staff_members
  where id = input_staff_member_id
    and operator_id = public.current_operator_id();

  if tenant_id is null then
    raise exception 'Staff member not found';
  end if;

  if public.current_app_role() not in ('operator_owner', 'operations_supervisor') then
    raise exception 'Only managers can override attendance';
  end if;

  if input_checked_in then
    insert into public.attendance_logs (
      operator_id,
      staff_member_id,
      checked_in_at,
      supervisor_override,
      notes
    )
    values (
      tenant_id,
      input_staff_member_id,
      input_attendance_date::timestamptz + time '08:00',
      true,
      nullif(trim(coalesce(input_note, '')), '')
    )
    returning id into attendance_id;

    delete from public.absence_logs
    where staff_member_id = input_staff_member_id
      and absence_date = input_attendance_date;

    return attendance_id;
  end if;

  insert into public.absence_logs (
    operator_id,
    staff_member_id,
    absence_date,
    reason,
    recorded_by_profile_id
  )
  values (
    tenant_id,
    input_staff_member_id,
    input_attendance_date,
    coalesce(nullif(trim(input_reason), ''), 'No reason provided'),
    auth.uid()
  )
  on conflict (staff_member_id, absence_date)
  do update set
    reason = excluded.reason,
    recorded_by_profile_id = excluded.recorded_by_profile_id,
    created_at = now()
  returning id into attendance_id;

  delete from public.attendance_logs
  where staff_member_id = input_staff_member_id
    and checked_in_at::date = input_attendance_date;

  return attendance_id;
end;
$$;

create or replace function public.monthly_staff_summary(input_month date default date_trunc('month', current_date)::date)
returns jsonb
language sql
stable
security invoker
as $$
  with month_bounds as (
    select
      date_trunc('month', input_month)::date as start_date,
      (date_trunc('month', input_month) + interval '1 month - 1 day')::date as end_date
  ),
  attendance_counts as (
    select
      attendance_logs.staff_member_id,
      count(distinct attendance_logs.checked_in_at::date)::int as days_checked_in
    from public.attendance_logs, month_bounds
    where attendance_logs.operator_id = public.current_operator_id()
      and attendance_logs.checked_in_at::date between month_bounds.start_date and month_bounds.end_date
    group by attendance_logs.staff_member_id
  ),
  absence_counts as (
    select
      absence_logs.staff_member_id,
      count(*)::int as days_absent
    from public.absence_logs, month_bounds
    where absence_logs.operator_id = public.current_operator_id()
      and absence_logs.absence_date between month_bounds.start_date and month_bounds.end_date
    group by absence_logs.staff_member_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'staffMemberId', staff_members.id,
        'fullName', staff_members.full_name,
        'role', staff_members.role,
        'monthlySalaryKobo', staff_members.monthly_salary_kobo,
        'daysCheckedIn', coalesce(attendance_counts.days_checked_in, 0),
        'daysAbsent', coalesce(absence_counts.days_absent, 0),
        'estimatedPayrollKobo', staff_members.monthly_salary_kobo
      )
      order by staff_members.full_name
    ),
    '[]'::jsonb
  )
  from public.staff_members
  left join attendance_counts on attendance_counts.staff_member_id = staff_members.id
  left join absence_counts on absence_counts.staff_member_id = staff_members.id
  where staff_members.operator_id = public.current_operator_id()
    and staff_members.active;
$$;
