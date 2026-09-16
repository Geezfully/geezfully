-- NOT APPLIED YET (needs the SETKA account).
--
-- attp_sync_ping() used to give up when another pull was running. Stress test
-- on 2026-09-16: 25 simultaneous pings produced exactly one pull. Right for a
-- burst, but a change committed in ATTP while that one pull was already reading
-- the feed would then wait for the 5-minute cron instead of arriving in seconds.
--
-- Now a ping waits for the running pull to finish, then runs its own — unless a
-- pull already started after the ping arrived, which necessarily saw its change.
-- A burst still collapses to about two pulls instead of one per ping.
create or replace function public.attp_sync_ping()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_arrived timestamptz := clock_timestamp();
  v_key text;
  v_expected text;
begin
  begin
    v_key := current_setting('request.headers', true)::json ->> 'x-setka-feed-key';
  exception when others then
    v_key := null;
  end;
  select decrypted_secret into v_expected from vault.decrypted_secrets where name = 'attp_feed_key';
  if v_expected is null or v_key is null or v_key <> v_expected then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- Same lock attp_sync_pull() takes, held until the running pull commits, so
  -- the check below reads its finished status. Re-taking it inside the pull is
  -- a no-op for the session that already holds it.
  perform pg_advisory_xact_lock(hashtext('attp_sync_pull'));
  if coalesce((select last_attempt_at from attp_sync_status where id), '-infinity') < v_arrived then
    perform attp_sync_pull();
  end if;
end;
$$;

revoke all on function public.attp_sync_ping() from public, authenticated;
grant execute on function public.attp_sync_ping() to anon;
