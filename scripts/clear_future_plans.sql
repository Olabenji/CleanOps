-- Clear future plans + recover-tomorrow artifacts after ops date 2026-07-24.
-- Keeps today (2026-07-24) and historical past data.

begin;

create temporary table tmp_future_mg on commit drop as
select id
from public.collection_make_goods
where target_date > date '2026-07-24'
   or source_date > date '2026-07-24';

create temporary table tmp_future_routes on commit drop as
select id
from public.routes
where scheduled_date > date '2026-07-24';

create temporary table tmp_future_notifications on commit drop as
select rn.id
from public.resident_notifications rn
where rn.make_good_id in (select id from tmp_future_mg)
   or nullif(rn.payload->>'targetDate', '')::date > date '2026-07-24'
   or nullif(rn.payload->>'sourceDate', '')::date > date '2026-07-24'
   or nullif(rn.payload->>'completedDate', '')::date > date '2026-07-24';

-- Outbox rows for those notifications
delete from public.notification_outbox
where notification_id in (select id from tmp_future_notifications);

delete from public.resident_notifications
where id in (select id from tmp_future_notifications);

-- Compliance cases tied to future routes (none expected; safe)
delete from public.compliance_cases
where route_id in (select id from tmp_future_routes);

-- Future recoveries / make-goods (coverage board source)
delete from public.collection_make_goods
where id in (select id from tmp_future_mg);

-- Future planned zone runs (stops/notices/handoffs/dumpsite cascade)
delete from public.routes
where id in (select id from tmp_future_routes);

-- Clear leftover make-good badges on remaining stops with no active link
update public.route_stops rs
set is_make_good = false
where rs.is_make_good
  and not exists (
    select 1
    from public.route_stop_make_goods link
    join public.collection_make_goods cmg on cmg.id = link.make_good_id
    where link.route_stop_id = rs.id
      and cmg.status in ('open', 'scheduled')
  );

-- Verify
select 'routes_after_today' as kind, count(*)::int as n
from public.routes where scheduled_date > date '2026-07-24'
union all
select 'mg_after_today', count(*)::int
from public.collection_make_goods
where target_date > date '2026-07-24' or source_date > date '2026-07-24'
union all
select 'routes_today', count(*)::int
from public.routes where scheduled_date = date '2026-07-24'
union all
select 'open_scheduled_mg', count(*)::int
from public.collection_make_goods where status in ('open', 'scheduled')
union all
select 'pending_make_good_flags', count(*)::int
from public.route_stops where is_make_good and status = 'pending'
union all
select 'notifications_remaining', count(*)::int
from public.resident_notifications;

commit;
