-- Players' Setka Cup rating history ("Statistici jucători").
--
-- Every morning the edge function setka-rating-sync reads the Setka Cup rating
-- list (tabletennis.setkacup.com/api/Players/en/rating?date=YYYY-MM-DD) for the
-- day that just ended in Moldova and stores one point per player. The same call
-- with an older date gives the rating as it was on that day, which is how the
-- history since 2026-08-01 was backfilled: daily and backfilled points come
-- from the exact same source.
--
-- Stored: every Moldovan player on Setka, plus anyone linked to a participant
-- (a few participants play for other countries). ~260 rows/day, <100k/year.
--
-- Nothing fails silently:
--   * each attempt writes a row to setka_sync_log (ok / eroare + message);
--   * cron retries every 15 minutes from 06:00 to ~08:45 Moldova time;
--   * a separate watchdog (pure SQL, independent of the edge function) emails
--     the admin at ~09:15 if the day still has no successful sync;
--   * the app shows a red alert when the latest final point is older than yesterday.
-- During the day a 'live' run every 3 hours keeps today's point close to
-- setkacup.com; it is provisional and replaced by the next morning's final value.
begin;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Setka Cup players we track: latest known profile + totals.
create table if not exists public.setka_jucatori (
  setka_id     integer primary key,
  prenume      text not null,
  nume         text not null,
  barbat       boolean,
  oras         text,
  tara         text,
  an_nastere   integer,
  foto         text,            -- Setka image token
  pondere      integer,         -- scWeightForRating
  turnee       integer,
  meciuri      integer,
  victorii     integer,
  infrangeri   integer,
  actualizat_la timestamptz not null default now()
);

-- One rating point per player per day.
create table if not exists public.setka_rating_istoric (
  setka_id  integer not null references public.setka_jucatori(setka_id) on delete cascade,
  data      date not null,
  rating    numeric(6,1) not null,
  primary key (setka_id, data)
);
create index if not exists setka_rating_istoric_data_idx on public.setka_rating_istoric (data);

create table if not exists public.setka_sync_log (
  id            bigint generated always as identity primary key,
  pornit_la     timestamptz not null default now(),
  terminat_la   timestamptz,
  data_rating   date not null,   -- the Setka rating day that was requested
  tip           text not null default 'zilnic' check (tip in ('zilnic','backfill','manual','live')),
  status        text not null default 'in_curs' check (status in ('in_curs','ok','eroare')),
  jucatori      integer,
  legati_auto   integer,         -- participants auto-linked during this run
  eroare        text
);
create index if not exists setka_sync_log_data_idx on public.setka_sync_log (data_rating, status);

-- Link participant -> Setka player. setka_legat_manual = an admin decided
-- (linked by hand, or marked "not on Setka" with setka_id null); the automatic
-- name matching never overrides that.
alter table public.participanti add column if not exists setka_id integer;
alter table public.participanti add column if not exists setka_legat_manual boolean not null default false;
create unique index if not exists participanti_setka_id_key on public.participanti (setka_id) where setka_id is not null;

alter table public.setka_jucatori enable row level security;
alter table public.setka_rating_istoric enable row level security;
alter table public.setka_sync_log enable row level security;

-- Read-only for everyone logged into the register; only the edge function
-- (service role) writes.
drop policy if exists "setka jucatori: citire" on public.setka_jucatori;
create policy "setka jucatori: citire" on public.setka_jucatori
  for select to authenticated using ((select is_administrator()));
drop policy if exists "setka rating: citire" on public.setka_rating_istoric;
create policy "setka rating: citire" on public.setka_rating_istoric
  for select to authenticated using ((select is_administrator()));
drop policy if exists "setka sync log: citire" on public.setka_sync_log;
create policy "setka sync log: citire" on public.setka_sync_log
  for select to authenticated using ((select is_administrator()));

-- Moldova's calendar day (the server runs in UTC).
create or replace function public.moldova_today()
returns date language sql stable as $$
  select (now() at time zone 'Europe/Chisinau')::date
$$;

-- One row per tracked player for the list view: latest rating, the rating
-- 7 and 30 days before it, and the last 90 days for the sparkline. The full
-- series is read from setka_rating_istoric only when a player is opened.
create or replace function public.setka_rating_rezumat()
returns table (setka_id integer, rating numeric, data date, rating_7z numeric, rating_30z numeric, serie numeric[])
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with ultim as (
    select distinct on (h.setka_id) h.setka_id, h.data, h.rating
      from setka_rating_istoric h
     order by h.setka_id, h.data desc
  )
  select u.setka_id, u.rating, u.data,
         (select h.rating from setka_rating_istoric h
           where h.setka_id = u.setka_id and h.data <= u.data - 7 order by h.data desc limit 1),
         (select h.rating from setka_rating_istoric h
           where h.setka_id = u.setka_id and h.data <= u.data - 30 order by h.data desc limit 1),
         array(select h.rating from setka_rating_istoric h
                where h.setka_id = u.setka_id and h.data > u.data - 90 order by h.data)
    from ultim u
$$;

revoke all on function public.setka_rating_rezumat() from public, anon;
grant execute on function public.setka_rating_rezumat() to authenticated;

-- Watchdog: emails the admin when yesterday's ratings are still missing.
-- Deliberately does not depend on the edge function, so it also catches the
-- function being down, undeployed or never called.
create or replace function public.setka_sync_watchdog()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_day date := public.moldova_today() - 1;
  v_key text;
  v_last record;
  v_attempts integer;
begin
  -- a provisional 'live' point is not the day's final value
  if exists (select 1 from setka_sync_log where data_rating = v_day and status = 'ok' and tip <> 'live') then
    return;
  end if;

  select count(*) into v_attempts from setka_sync_log where data_rating = v_day;
  select pornit_la, status, eroare into v_last
    from setka_sync_log where data_rating = v_day order by pornit_la desc limit 1;

  v_key := public.get_resend_api_key();
  if v_key is null then
    raise warning 'setka_sync_watchdog: no Resend key, cannot alert';
    return;
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'ATTP Pontaj <onboarding@resend.dev>',
      'to', jsonb_build_array('berlibaflorentiu@gmail.com'),
      'subject', 'ATTP Pontaj: ratingul Setka NU s-a actualizat (' || to_char(v_day, 'DD.MM.YYYY') || ')',
      'html',
        '<p>Sincronizarea zilnică a ratingului Setka Cup pentru <b>' || to_char(v_day, 'DD.MM.YYYY') ||
        '</b> nu a reușit până acum.</p>' ||
        '<p>Încercări: <b>' || v_attempts || '</b>' ||
        case when v_last is null then '<br>Nicio încercare înregistrată: cron-ul sau funcția setka-rating-sync nu rulează.'
             else '<br>Ultima încercare: ' || to_char(v_last.pornit_la at time zone 'Europe/Chisinau', 'HH24:MI') ||
                  ' — ' || v_last.status || coalesce(': ' || replace(replace(v_last.eroare, '<', '&lt;'), '>', '&gt;'), '')
        end || '</p>' ||
        '<p>Ziua lipsă poate fi recuperată oricând (Setka păstrează istoricul): ' ||
        'rulați din nou funcția cu {"date":"' || v_day || '"}.</p>'
    ),
    timeout_milliseconds := 20000);
end;
$$;

revoke all on function public.setka_sync_watchdog() from public, anon, authenticated;

commit;

-- Cron (run once, after the edge function is deployed; the secret is the same
-- x-cron-secret used by daily-backup):
--
-- Every 15 min between 03:00 and 05:45 UTC. The function itself waits until
-- 06:00 Moldova time (so 06:00–08:45 in summer, 06:00–07:45 in winter) and
-- does nothing once the day is stored.
--   select cron.schedule('setka-rating-sync', '*/15 3-5 * * *', $$
--     select net.http_post(
--       url := 'https://ildoegipvcgxboijfksw.supabase.co/functions/v1/setka-rating-sync',
--       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<secret>'),
--       body := '{}'::jsonb,
--       timeout_milliseconds := 150000);
--   $$);
--
-- Live refresh of today's provisional point every 3 hours, 07:00-19:00 UTC
-- (10:00-22:00 summer / 09:00-21:00 winter in Moldova):
--   select cron.schedule('setka-rating-live', '0 7-19/3 * * *', $$
--     select net.http_post(
--       url := 'https://ildoegipvcgxboijfksw.supabase.co/functions/v1/setka-rating-sync',
--       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<secret>'),
--       body := '{"live":true}'::jsonb,
--       timeout_milliseconds := 150000);
--   $$);
--
-- Watchdog at 06:15 UTC (09:15 summer / 08:15 winter), after the last retry:
--   select cron.schedule('setka-rating-watchdog', '15 6 * * *', 'select public.setka_sync_watchdog()');
