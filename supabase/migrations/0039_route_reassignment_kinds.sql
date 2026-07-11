-- Part 1: schema for unified truck/driver/both reassignment.
-- New enum values are committed here; RPC logic that references new reason labels lands in 0040.

create type public.route_reassignment_kind as enum (
  'truck',
  'driver',
  'both'
);

alter type public.route_truck_handoff_reason add value if not exists 'driver_sick';
alter type public.route_truck_handoff_reason add value if not exists 'driver_unavailable';

alter table public.route_truck_handoffs
  add column if not exists change_kind public.route_reassignment_kind not null default 'both';

alter table public.route_truck_handoffs
  drop constraint if exists route_truck_handoffs_different_truck;

alter table public.route_truck_handoffs
  drop constraint if exists route_truck_handoffs_meaningful_change;

alter table public.route_truck_handoffs
  add constraint route_truck_handoffs_meaningful_change check (
    (
      change_kind = 'truck'
      and from_truck_id is distinct from to_truck_id
    )
    or (
      change_kind = 'driver'
      and from_driver_id is distinct from to_driver_id
      and from_truck_id is not distinct from to_truck_id
    )
    or (
      change_kind = 'both'
      and (
        from_truck_id is distinct from to_truck_id
        or from_driver_id is distinct from to_driver_id
      )
    )
  );

comment on column public.route_truck_handoffs.change_kind is
  'truck = vehicle swap; driver = cover sick/unavailable (same truck); both = replace vehicle and/or driver.';

create or replace function public.route_truck_handoff_json(handoff public.route_truck_handoffs)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', handoff.id,
    'routeId', handoff.route_id,
    'routeZoneName', zones.name,
    'routeStatus', routes.status,
    'scheduledDate', routes.scheduled_date,
    'pendingStops', (
      select count(*)::int
      from public.route_stops
      where route_stops.route_id = handoff.route_id
        and route_stops.status = 'pending'
    ),
    'changeKind', handoff.change_kind,
    'fromTruckId', handoff.from_truck_id,
    'fromTruckRegistration', from_truck.registration_number,
    'toTruckId', handoff.to_truck_id,
    'toTruckRegistration', to_truck.registration_number,
    'fromDriverId', handoff.from_driver_id,
    'fromDriverName', from_driver.full_name,
    'toDriverId', handoff.to_driver_id,
    'toDriverName', to_driver.full_name,
    'sourceRouteId', handoff.source_route_id,
    'sourceRouteZoneName', source_zone.name,
    'sourceOutcome', handoff.source_outcome,
    'reason', handoff.reason,
    'notes', handoff.notes,
    'status', handoff.status,
    'requiresOutgoingConfirmation', (
      handoff.from_driver_id is not null
      and handoff.from_driver_id is distinct from handoff.to_driver_id
      and routes.status = 'in_progress'
    ),
    'incomingConfirmed', handoff.incoming_confirmed_at is not null,
    'outgoingConfirmed', handoff.outgoing_confirmed_at is not null,
    'expiresAt', handoff.expires_at,
    'createdAt', handoff.created_at,
    'confirmedAt', handoff.confirmed_at,
    'rejectedAt', handoff.rejected_at,
    'cancelledAt', handoff.cancelled_at
  )
  from public.routes
  join public.zones on zones.id = routes.zone_id
  join public.trucks to_truck on to_truck.id = handoff.to_truck_id
  left join public.trucks from_truck on from_truck.id = handoff.from_truck_id
  left join public.staff_members from_driver on from_driver.id = handoff.from_driver_id
  left join public.staff_members to_driver on to_driver.id = handoff.to_driver_id
  left join public.routes source_route on source_route.id = handoff.source_route_id
  left join public.zones source_zone on source_zone.id = source_route.zone_id
  where routes.id = handoff.route_id;
$$;
