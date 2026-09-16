-- ATTP Pontaj -> SETKA-PRO "Alte compensări", fully automatic.
--
-- Three kinds of ATTP register entries are charged to the player's pay:
--   spălătorie   rows linked to a player (unlinked rows are the location's cost)
--   daune        rows with valoare_estimata > 0
--   antrenamente every session, the player's share (suma_jucator, 100 MDL)
--
-- Each kind gets its own column on monthly_entries next to the manual amount.
-- alte_compensari stays the one number everything else already reads (the
-- act, the CSV, entry_totals), and is now always their sum:
--   alte_compensari = manual + spalatorie + daune + antrenamente
--
-- Data arrives two ways, both calling attp_sync_pull():
--   * immediately: ATTP fires a pg_net request at attp_sync_ping() after every
--     insert/update/delete on the three tables;
--   * every 5 minutes from pg_cron, in case a ping is lost.
-- One pull is a single HTTP call returning a few dozen rows.
--
-- Starts 28 Aug 2026, the first day of SETKA's September 2026 business period
-- (the ATTP feed returns nothing earlier).
-- Locked periods are never touched: their charges and totals stay frozen.
-- Players are matched automatically (last name + first word of ATTP prenume,
-- accent/case-insensitive, must be unique); a manual link can override.

begin;

-- ── Per-source amounts on the monthly row ───────────────────────────────
alter table public.monthly_entries
  add column if not exists alte_compensari_manual numeric not null default 0,
  add column if not exists alte_compensari_spalatorie numeric not null default 0,
  add column if not exists alte_compensari_daune numeric not null default 0,
  add column if not exists alte_compensari_antrenamente numeric not null default 0;

-- Every existing amount was typed by hand. Skip triggers so locked months can
-- be backfilled and updated_at is not bumped — nothing visible changes.
set local session_replication_role = replica;
update public.monthly_entries
   set alte_compensari_manual = alte_compensari
 where alte_compensari_manual is distinct from alte_compensari;
set local session_replication_role = origin;

-- Keeps the total right no matter who writes the row. The three ATTP columns
-- are owned by the sync: any other writer (the app upserts the whole row it
-- loaded, which may be minutes old) gets the stored values back. An app build
-- that still only knows alte_compensari keeps working: its edit to the total
-- is read as an edit to the manual part.
create or replace function public.monthly_entries_alte_compensari_total()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_from_sync boolean := coalesce(current_setting('setka.attp_sync', true), '') = 'on';
begin
  if not v_from_sync then
    if tg_op = 'UPDATE' then
      new.alte_compensari_spalatorie := old.alte_compensari_spalatorie;
      new.alte_compensari_daune := old.alte_compensari_daune;
      new.alte_compensari_antrenamente := old.alte_compensari_antrenamente;
      if new.alte_compensari_manual is not distinct from old.alte_compensari_manual
         and new.alte_compensari is distinct from old.alte_compensari then
        new.alte_compensari_manual := greatest(
          coalesce(new.alte_compensari, 0) - old.alte_compensari_spalatorie
          - old.alte_compensari_daune - old.alte_compensari_antrenamente, 0);
      end if;
    else
      new.alte_compensari_spalatorie := 0;
      new.alte_compensari_daune := 0;
      new.alte_compensari_antrenamente := 0;
      if coalesce(new.alte_compensari_manual, 0) = 0 then
        new.alte_compensari_manual := coalesce(new.alte_compensari, 0);
      end if;
    end if;
  end if;

  new.alte_compensari_manual := abs(coalesce(new.alte_compensari_manual, 0));
  new.alte_compensari := new.alte_compensari_manual + new.alte_compensari_spalatorie
    + new.alte_compensari_daune + new.alte_compensari_antrenamente;
  return new;
end;
$$;

drop trigger if exists monthly_entries_alte_compensari_total on public.monthly_entries;
create trigger monthly_entries_alte_compensari_total
before insert or update on public.monthly_entries
for each row execute function public.monthly_entries_alte_compensari_total();

-- ── Mirror of the ATTP charges ──────────────────────────────────────────
create table if not exists public.attp_referee_links (
  attp_participant_id uuid primary key,
  nume text not null,
  prenume text not null,
  referee_id uuid references public.referees(id) on delete set null,
  match_status text not null default 'unmatched'
    check (match_status in ('auto', 'manual', 'unmatched')),
  updated_at timestamptz not null default now()
);

create table if not exists public.attp_deduceri (
  sursa_id uuid primary key,
  sursa text not null check (sursa in ('spalatorie', 'daune', 'treninguri')),
  attp_participant_id uuid not null,
  data date not null,
  period date not null,
  suma numeric not null,
  detalii text,
  synced_at timestamptz not null default now()
);
create index if not exists attp_deduceri_period_idx on public.attp_deduceri (period, attp_participant_id);

create table if not exists public.attp_sync_status (
  id boolean primary key default true check (id),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  rows_received integer
);
insert into public.attp_sync_status (id) values (true) on conflict do nothing;

alter table public.attp_referee_links enable row level security;
alter table public.attp_deduceri enable row level security;
alter table public.attp_sync_status enable row level security;

drop policy if exists attp_referee_links_approved_select on public.attp_referee_links;
create policy attp_referee_links_approved_select on public.attp_referee_links
  for select to authenticated using (public.is_approved());
drop policy if exists attp_deduceri_approved_select on public.attp_deduceri;
create policy attp_deduceri_approved_select on public.attp_deduceri
  for select to authenticated using (public.is_approved());
drop policy if exists attp_sync_status_approved_select on public.attp_sync_status;
create policy attp_sync_status_approved_select on public.attp_sync_status
  for select to authenticated using (public.is_approved());

revoke all on public.attp_referee_links, public.attp_deduceri, public.attp_sync_status from anon, authenticated;
grant select on public.attp_referee_links, public.attp_deduceri, public.attp_sync_status to authenticated;

-- ── Apply a feed snapshot ───────────────────────────────────────────────
-- p_rows is the ATTP feed output (every row since p_from). Everything in an
-- unlocked period is replaced by it, so edits and deletions in ATTP carry over.
create or replace function public.attp_sync_apply(p_rows jsonb, p_from date)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform set_config('setka.attp_sync', 'on', true);
  drop table if exists pg_temp.incoming, pg_temp.touched, pg_temp.totals;

  -- Links: remember every participant seen; match the ones not yet matched.
  insert into attp_referee_links (attp_participant_id, nume, prenume)
  select distinct on ((r->>'participant_id')::uuid)
         (r->>'participant_id')::uuid, r->>'nume', r->>'prenume'
    from jsonb_array_elements(p_rows) r
  on conflict (attp_participant_id) do update
     set nume = excluded.nume, prenume = excluded.prenume, updated_at = now()
   where attp_referee_links.nume is distinct from excluded.nume
      or attp_referee_links.prenume is distinct from excluded.prenume;

  update attp_referee_links l
     set referee_id = m.referee_id,
         match_status = case when m.referee_id is null then 'unmatched' else 'auto' end,
         updated_at = now()
    from (
      select l2.attp_participant_id,
             (select case when count(*) = 1 then min(rf.id::text)::uuid end
                from referees rf
               where lower(unaccent(btrim(rf.last_name))) = lower(unaccent(btrim(l2.nume)))
                 and lower(unaccent(btrim(rf.first_name))) in (
                       lower(unaccent(btrim(l2.prenume))),
                       lower(unaccent(split_part(btrim(l2.prenume), ' ', 1))))) as referee_id
        from attp_referee_links l2
       where l2.match_status <> 'manual'
    ) m
   where l.attp_participant_id = m.attp_participant_id
     and l.referee_id is distinct from m.referee_id;

  -- Charges: replace the mirror for every unlocked period from p_from on.
  create temp table incoming on commit drop as
  select (r->>'sursa_id')::uuid sursa_id, r->>'sursa' sursa,
         (r->>'participant_id')::uuid attp_participant_id,
         (r->>'data')::date data, business_period((r->>'data')::date) period,
         (r->>'suma')::numeric suma, r->>'detalii' detalii
    from jsonb_array_elements(p_rows) r;

  create temp table touched on commit drop as
  select distinct period from attp_deduceri where data >= p_from
  union
  select distinct period from incoming;
  delete from touched t using locked_periods lp where lp.period = t.period;

  delete from attp_deduceri d
   where d.data >= p_from
     and d.period in (select period from touched)
     and not exists (select 1 from incoming i where i.sursa_id = d.sursa_id and i.period = d.period);

  insert into attp_deduceri (sursa_id, sursa, attp_participant_id, data, period, suma, detalii)
  select i.sursa_id, i.sursa, i.attp_participant_id, i.data, i.period, i.suma, i.detalii
    from incoming i
   where i.period in (select period from touched)
  on conflict (sursa_id) do update
     set sursa = excluded.sursa, attp_participant_id = excluded.attp_participant_id,
         data = excluded.data, period = excluded.period, suma = excluded.suma,
         detalii = excluded.detalii, synced_at = now()
   where (attp_deduceri.sursa, attp_deduceri.attp_participant_id, attp_deduceri.data,
          attp_deduceri.period, attp_deduceri.suma, attp_deduceri.detalii)
         is distinct from
         (excluded.sursa, excluded.attp_participant_id, excluded.data,
          excluded.period, excluded.suma, excluded.detalii);

  -- Totals per referee/period for the touched periods.
  create temp table totals on commit drop as
  select l.referee_id, d.period,
         coalesce(sum(d.suma) filter (where d.sursa = 'spalatorie'), 0) spalatorie,
         coalesce(sum(d.suma) filter (where d.sursa = 'daune'), 0) daune,
         coalesce(sum(d.suma) filter (where d.sursa = 'treninguri'), 0) antrenamente
    from attp_deduceri d
    join attp_referee_links l on l.attp_participant_id = d.attp_participant_id
   where l.referee_id is not null
     and d.period in (select period from touched)
   group by 1, 2;

  insert into monthly_entries (referee_id, period)
  select t.referee_id, t.period from totals t
  on conflict (referee_id, period) do nothing;

  update monthly_entries me
     set alte_compensari_spalatorie = coalesce(t.spalatorie, 0),
         alte_compensari_daune = coalesce(t.daune, 0),
         alte_compensari_antrenamente = coalesce(t.antrenamente, 0)
    from monthly_entries me2
    left join totals t on t.referee_id = me2.referee_id and t.period = me2.period
   where me.id = me2.id
     and me2.period in (select period from touched)
     and (me2.alte_compensari_spalatorie, me2.alte_compensari_daune, me2.alte_compensari_antrenamente)
         is distinct from (coalesce(t.spalatorie, 0), coalesce(t.daune, 0), coalesce(t.antrenamente, 0));

  perform set_config('setka.attp_sync', '', true);
end;
$$;

-- ── Fetch from ATTP ─────────────────────────────────────────────────────
-- Vault secrets used: attp_feed_url, attp_feed_apikey, attp_feed_key.
create or replace function public.attp_sync_pull()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  c_start constant date := date '2026-08-28';
  v_from date;
  v_url text;
  v_apikey text;
  v_key text;
  v_resp extensions.http_response;
  v_rows jsonb;
begin
  -- A ping and the cron tick can land together; the second just skips.
  if not pg_try_advisory_xact_lock(hashtext('attp_sync_pull')) then
    return;
  end if;

  update attp_sync_status set last_attempt_at = now() where id;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'attp_feed_url';
  select decrypted_secret into v_apikey from vault.decrypted_secrets where name = 'attp_feed_apikey';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'attp_feed_key';
  if v_url is null or v_apikey is null or v_key is null then
    update attp_sync_status set last_error = 'ATTP feed not configured' where id;
    return;
  end if;

  -- First day of the oldest period still open, never before the integration start.
  select coalesce(min(d), current_date) into v_from
    from (select generate_series(greatest(c_start, current_date - 400), current_date, interval '1 day')::date d) days
   where not exists (select 1 from locked_periods lp where lp.period = business_period(days.d));

  begin
    perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '15000');
    select * into v_resp from http((
      'POST', v_url || '/rest/v1/rpc/setka_deduceri',
      array[http_header('apikey', v_apikey), http_header('x-setka-feed-key', v_key)],
      'application/json', jsonb_build_object('p_de_la', v_from)::text
    )::http_request);
  exception when others then
    update attp_sync_status set last_error = 'HTTP: ' || sqlerrm where id;
    return;
  end;

  if v_resp.status <> 200 then
    update attp_sync_status set last_error = 'ATTP ' || v_resp.status || ': ' || left(v_resp.content, 300) where id;
    return;
  end if;

  begin
    v_rows := v_resp.content::jsonb;
    if jsonb_typeof(v_rows) <> 'array' then
      raise exception 'expected a JSON array';
    end if;
    perform attp_sync_apply(v_rows, v_from);
  exception when others then
    update attp_sync_status set last_error = 'Apply: ' || sqlerrm where id;
    return;
  end;

  update attp_sync_status
     set last_success_at = now(), last_error = null, rows_received = jsonb_array_length(v_rows)
   where id;
end;
$$;

-- ── Instant trigger, called by ATTP through pg_net ──────────────────────
create or replace function public.attp_sync_ping()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
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
  perform attp_sync_pull();
end;
$$;

revoke all on function public.monthly_entries_alte_compensari_total() from public, anon, authenticated;
revoke all on function public.attp_sync_apply(jsonb, date) from public, anon, authenticated;
revoke all on function public.attp_sync_pull() from public, anon, authenticated;
revoke all on function public.attp_sync_ping() from public, authenticated;
grant execute on function public.attp_sync_ping() to anon;

-- ── Backstop schedule ───────────────────────────────────────────────────
select cron.unschedule(jobid) from cron.job where jobname = 'attp-deduceri-sync';
select cron.schedule('attp-deduceri-sync', '*/5 * * * *', 'select public.attp_sync_pull();');

commit;

-- Secrets (run once; the key must match the one configured in ATTP):
--   select vault.create_secret('https://ildoegipvcgxboijfksw.supabase.co', 'attp_feed_url');
--   select vault.create_secret('<ATTP publishable key>', 'attp_feed_apikey');
--   select vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'attp_feed_key');
