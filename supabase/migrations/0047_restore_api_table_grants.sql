-- Restore API role table/sequence privileges required by PostgREST and the web client.
-- Without these, authenticated sessions fail with "permission denied for table …"
-- even though tenant rows still exist (RLS alone is not enough).

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select, update on all sequences in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;

alter default privileges in schema public
  grant usage, select, update on sequences to anon, authenticated, service_role;
