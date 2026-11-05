-- Health check for the external watcher (.github/workflows/attp-pontaj-health.yml).
--
-- On 5 Nov 2026 PostgREST's query pool wedged for ~70 minutes while the
-- database itself stayed healthy; only a project restart cleared it. This
-- function answers only when PostgREST can actually run a query on the
-- database, so the watcher can tell "Data API broken" from "all fine".
-- It reads nothing and exposes only the server time.
create or replace function public.health_ping()
returns json
language sql
stable
set search_path = pg_catalog
as $$
  select json_build_object('ok', true, 'at', now());
$$;

revoke all on function public.health_ping() from public;
grant execute on function public.health_ping() to anon, authenticated;
