-- Allow operators to request password reset for staff without an Edge Function.

create or replace function public.get_staff_password_reset_target(input_staff_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
  staff_row public.staff_members%rowtype;
begin
  select *
  into staff_row
  from public.staff_members
  where id = input_staff_id
    and operator_id = tenant_id;

  if not found then
    raise exception 'Staff member not found';
  end if;

  if staff_row.profile_id is null or staff_row.login_email is null then
    raise exception 'Staff member has no linked login profile';
  end if;

  return jsonb_build_object(
    'loginEmail', staff_row.login_email,
    'staffName', staff_row.full_name
  );
end;
$$;
