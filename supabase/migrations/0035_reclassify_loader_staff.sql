-- Reclassify seeded loader crews that were incorrectly stored as drivers.

update public.staff_members
set role = 'loader'
where role = 'driver'
  and (
    full_name ilike 'Loader Team%'
    or full_name = 'Relief Loader'
  );
