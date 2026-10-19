-- Day check: every finished game day should have 24 matches with a result and a line-up on both sides.
-- verificare_zile() reports each day; zile_avertizari is the append-only log of hiding / restoring a day's warning.

create table if not exists public.zile_avertizari (
  id uuid primary key default gen_random_uuid(),
  data date not null,                                   -- the game day the warning is about
  actiune text not null check (actiune in ('ascunsa', 'restabilita')),
  meciuri int,                                          -- matches with a result when the action was taken
  loturi_goale int,                                     -- empty line-up sides when the action was taken
  motiv text,
  administrator_id uuid references public.administratori(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists zile_avertizari_data_idx on public.zile_avertizari (data, created_at desc);

alter table public.zile_avertizari enable row level security;
drop policy if exists "zile_avertizari: citire" on public.zile_avertizari;
create policy "zile_avertizari: citire" on public.zile_avertizari for select to authenticated
  using ((select public.is_administrator()));
drop policy if exists "zile_avertizari: inserare admin" on public.zile_avertizari;
create policy "zile_avertizari: inserare admin" on public.zile_avertizari for insert to authenticated
  with check ((select public.is_full_admin()) and administrator_id = (select auth.uid()));
-- no update / delete policies: the log can only grow

-- One row per calendar day from the first game day up to the last finished session.
-- A session runs past midnight (games until ~02:00 belong to the previous day), so day D is finished at 06:00 on D+1.
create or replace function public.verificare_zile(p_de date default null, p_pana date default null)
returns table(data date, meciuri int, cu_rezultat int, loturi_goale int, asteptate int)
language sql stable security definer set search_path = public
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
  )
  select z.zi,
         count(distinct l.id)::int,
         count(distinct l.id) filter (where l.cu_rezultat)::int,
         count(*) filter (where l.cu_rezultat and l.jucatori = 0)::int,
         24
    from zile z left join laturi l on l.data = z.zi
   group by z.zi
   order by z.zi;
$$;
revoke all on function public.verificare_zile(date, date) from public, anon;
grant execute on function public.verificare_zile(date, date) to authenticated;
