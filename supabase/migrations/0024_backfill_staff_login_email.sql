-- Backfill login_email for staff linked before the column existed.

update public.staff_members
set login_email = lower(auth.users.email)
from auth.users
where staff_members.profile_id = auth.users.id
  and staff_members.login_email is null
  and auth.users.email is not null;
