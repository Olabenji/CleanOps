-- Rename operator-facing "Zone" display names to "Ward".
-- Keeps schema identifiers (zones table, zone_id columns) unchanged.

update public.zones
set name = regexp_replace(name, '^Zone', 'Ward')
where name like 'Zone%';

update public.route_templates
set name = replace(name, 'Zone', 'Ward')
where name like '%Zone%';

update public.incident_reports
set title = replace(title, 'Zone', 'Ward')
where title like '%Zone%';
