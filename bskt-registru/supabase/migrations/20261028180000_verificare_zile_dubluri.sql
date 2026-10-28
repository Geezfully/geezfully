-- Day check also catches duplicates: on 25.10.2026 the site's copies of 13 sheet games stayed next to them (37 games
-- instead of 24) and nothing was flagged, because only days with FEWER than 24 games were reported.
-- New columns: games that repeat another game of the day (same time, same two teams) and players listed in two games
-- at the same time. The app reports a day with more than 24 games, any duplicated game or any doubled player.
drop function if exists public.verificare_zile(date, date);
create function public.verificare_zile(p_de date default null, p_pana date default null)
returns table(data date, meciuri integer, cu_rezultat integer, loturi_goale integer, asteptate integer,
              meciuri_dublate integer, jucatori_dubli integer)
language sql stable security definer set search_path to 'public'
as $$
  with lim as (
    select coalesce(p_de, (select min(m.data) from public.meciuri m)) as de,
           coalesce(p_pana, ((now() at time zone 'Europe/Chisinau') - interval '6 hours')::date - 1) as pana
  ),
  zile as (
    select d::date as zi from lim, generate_series(lim.de, lim.pana, interval '1 day') d
    where public.is_administrator()
  ),
  laturi as (
    select m.id, m.data, s.echipa_id,
           (m.scor_a is not null and m.scor_b is not null and m.scor_a <> m.scor_b) as cu_rezultat,
           (select count(*) from public.meci_jucatori j where j.meci_id = m.id and j.echipa_id = s.echipa_id) as jucatori
      from lim, public.meciuri m
      cross join lateral (values (m.echipa_a_id), (m.echipa_b_id)) s(echipa_id)
     where m.data between lim.de and lim.pana
  ),
  dubluri as (       -- every game beyond the first with the same time and the same two teams
    select m.data, count(*) - count(distinct (m.ora, least(m.echipa_a_id::text, m.echipa_b_id::text), greatest(m.echipa_a_id::text, m.echipa_b_id::text))) as n
      from lim, public.meciuri m where m.data between lim.de and lim.pana group by m.data
  ),
  jucatori as (      -- players listed in more than one game at the same time
    select x.data, count(*) as n from (
      select m.data, m.ora, j.participant_id from lim, public.meci_jucatori j join public.meciuri m on m.id = j.meci_id
       where m.data between lim.de and lim.pana group by m.data, m.ora, j.participant_id having count(*) > 1) x
     group by x.data
  )
  select z.zi,
         count(distinct l.id)::int,
         count(distinct l.id) filter (where l.cu_rezultat)::int,
         count(*) filter (where l.cu_rezultat and l.jucatori = 0)::int,
         24,
         coalesce(max(d.n), 0)::int,
         coalesce(max(jj.n), 0)::int
    from zile z left join laturi l on l.data = z.zi
    left join dubluri d on d.data = z.zi
    left join jucatori jj on jj.data = z.zi
   group by z.zi
   order by z.zi;
$$;
revoke all on function public.verificare_zile(date, date) from public, anon;
grant execute on function public.verificare_zile(date, date) to authenticated, service_role;
