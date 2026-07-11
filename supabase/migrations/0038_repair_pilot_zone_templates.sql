-- Repair pilot zone default templates corrupted by handoff/test saves.
-- Canonical pilot defaults: Zone A Adewale/LAG-001, Zone B Chinedu/LAG-002, Zone C Musa/LAG-003.

update public.route_templates
set
  driver_id = '00000000-0000-4000-8000-000000000201',
  truck_id = '00000000-0000-4000-8000-000000000301',
  updated_at = now()
where operator_id = '00000000-0000-4000-8000-000000000001'
  and zone_id = '00000000-0000-4000-8000-000000000101'
  and kind = 'zone_default';

update public.route_templates
set
  driver_id = '00000000-0000-4000-8000-000000000202',
  truck_id = '00000000-0000-4000-8000-000000000302',
  updated_at = now()
where operator_id = '00000000-0000-4000-8000-000000000001'
  and zone_id = '00000000-0000-4000-8000-000000000102'
  and kind = 'zone_default';

update public.route_templates
set
  driver_id = '00000000-0000-4000-8000-000000000203',
  truck_id = '00000000-0000-4000-8000-000000000303',
  updated_at = now()
where operator_id = '00000000-0000-4000-8000-000000000001'
  and zone_id = '00000000-0000-4000-8000-000000000103'
  and kind = 'zone_default';
