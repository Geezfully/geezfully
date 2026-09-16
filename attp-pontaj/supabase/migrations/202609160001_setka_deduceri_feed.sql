-- ATTP Pontaj -> SETKA-PRO deductions ("Alte compensări"). Counterpart of
-- setka-pontaj/supabase/migrations/20260916120000_attp_deduceri_sync.sql.
--
-- 1. setka_deduceri(p_de_la): read-only feed of the register entries charged to
--    a player's pay, from p_de_la on. Never before 2026-08-28, the first day of
--    SETKA's September 2026 business period; earlier months were deducted by hand:
--      spalatorie  rows linked to a player (the rest are the location's cost)
--      daune       rows with valoare_estimata > 0
--      treninguri  every session, the player's share (suma_jucator, 100 MDL)
--    SETKA assigns each row to its own accounting period.
--
-- 2. After any insert/update/delete on those three tables, one async pg_net
--    request tells SETKA to pull. The request is queued and sent after commit,
--    so saving in the register is never slowed down or blocked by SETKA.
--
-- Both directions use the same shared key, kept in Vault as 'setka_feed_key'
-- here and 'attp_feed_key' in SETKA. The feed exposes only name + birth date
-- for matching and the deduction lines: no phone, address or email.
begin;

create extension if not exists pg_net with schema extensions;

drop function if exists public.setka_deduceri_luna(date);

create or replace function public.setka_deduceri(p_de_la date)
returns table (
  sursa text,               -- 'spalatorie' | 'daune' | 'treninguri'
  sursa_id uuid,            -- stable id: SETKA upserts and notices edits/deletes
  data date,
  participant_id uuid,
  nume text,
  prenume text,
  data_nasterii date,
  suma numeric,
  detalii text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_expected text;
  v_from date := greatest(coalesce(p_de_la, date '2026-08-28'), date '2026-08-28');
begin
  begin
    v_key := current_setting('request.headers', true)::json ->> 'x-setka-feed-key';
  exception when others then
    v_key := null;
  end;
  select decrypted_secret into v_expected from vault.decrypted_secrets where name = 'setka_feed_key';
  if v_expected is null or v_key is null or v_key <> v_expected then
    raise exception 'SETKA_FEED_UNAUTHORIZED' using errcode = '42501';
  end if;

  return query
  select 'spalatorie'::text, s.id, s.data, p.id, p.nume, p.prenume, p.data_nasterii,
         s.suma, concat_ws(' · ', nullif(s.tip_articole, ''), s.cantitate || ' buc')
    from public.spalatorie s
    join public.participanti p on p.id = s.participant_id
   where s.data >= v_from and s.suma > 0
  union all
  select 'daune', d.id, d.data, p.id, p.nume, p.prenume, p.data_nasterii,
         d.valoare_estimata, concat_ws(' · ', nullif(d.inventar_afectat, ''), nullif(d.natura, ''), d.stare)
    from public.daune d
    join public.participanti p on p.id = d.participant_id
   where d.data >= v_from and d.valoare_estimata > 0
  union all
  select 'treninguri', t.id, t.data, p.id, p.nume, p.prenume, p.data_nasterii,
         t.suma_jucator, concat_ws(' · ', 'Antrenor: ' || t.antrenor, to_char(t.ora, 'HH24:MI'))
    from public.treninguri t
    join public.participanti p on p.id = t.participant_id
   where t.data >= v_from and t.suma_jucator > 0
  order by 3, 1;
end;
$$;

revoke all on function public.setka_deduceri(date) from public, authenticated;
grant execute on function public.setka_deduceri(date) to anon;

-- Statement-level: a bulk change sends one ping, not one per row.
create or replace function public.setka_ping_after_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'setka_feed_key';
  if v_key is not null then
    perform net.http_post(
      url := 'https://ufkeqoeyrhwvvvtiopyt.supabase.co/rest/v1/rpc/attp_sync_ping',
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'sb_publishable_ikWN1Xa22Mj90c1r6pwuhQ_eb8m7Juv',
        'x-setka-feed-key', v_key),
      timeout_milliseconds := 20000);
  end if;
  return null;
exception when others then
  -- Never let the SETKA link break the register; the 5-minute pull catches up.
  return null;
end;
$$;

revoke all on function public.setka_ping_after_change() from public, anon, authenticated;

drop trigger if exists setka_ping on public.spalatorie;
create trigger setka_ping after insert or update or delete on public.spalatorie
for each statement execute function public.setka_ping_after_change();

drop trigger if exists setka_ping on public.daune;
create trigger setka_ping after insert or update or delete on public.daune
for each statement execute function public.setka_ping_after_change();

drop trigger if exists setka_ping on public.treninguri;
create trigger setka_ping after insert or update or delete on public.treninguri
for each statement execute function public.setka_ping_after_change();

-- Participant renames change matching and the details SETKA shows.
drop trigger if exists setka_ping on public.participanti;
create trigger setka_ping after update of nume, prenume on public.participanti
for each statement execute function public.setka_ping_after_change();

commit;

-- Shared key (run once, same value as SETKA's 'attp_feed_key'):
--   select vault.create_secret('<key>', 'setka_feed_key');
