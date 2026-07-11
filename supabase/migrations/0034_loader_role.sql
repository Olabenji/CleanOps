-- Add loader staff role (value must commit before it can be used in later migrations).

alter type public.app_role add value if not exists 'loader';

comment on type public.app_role is
  'CleanOps app roles. Drivers operate routes; loaders are crew assigned to trucks/routes without driving the vehicle.';
