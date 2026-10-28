-- Public player profiles for the ATTP website (geezfully.com/attp): the website pulls them through the
-- edge function export-site. Nothing here writes to registry data; it only reads.
-- Published per player (only players with at least one scored game): first/last name, age (never the birth
-- date), games/wins/losses and each game's date + score from the player's side. Never the team, never any
-- other personal field. The photo is offered only when acord_date_personale is ticked.

-- Access keys for outside consumers. Only the SHA-256 of a key is stored; the key itself lives with the consumer.
create table if not exists public.export_chei (
  id uuid primary key default gen_random_uuid(),
  nume text not null,
  cheie_hash text not null unique,
  creat_la timestamptz not null default now(),
  revocat_la timestamptz
);
alter table public.export_chei enable row level security;
revoke all on public.export_chei from anon, authenticated;
grant all on public.export_chei to service_role;

create or replace function public.export_site_attp()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with azi as (select (now() at time zone 'Europe/Chisinau')::date as d),
  r as (
    select mj.participant_id as pid, m.id as meci, m.data, m.ora,
           case when mj.echipa_id = m.echipa_a_id then m.scor_a else m.scor_b end as pentru,
           case when mj.echipa_id = m.echipa_a_id then m.scor_b else m.scor_a end as contra
      from public.meci_jucatori mj
      join public.meciuri m on m.id = mj.meci_id
     where m.scor_a is not null and m.scor_b is not null and m.scor_a <> m.scor_b
  ),
  j as (
    select p.id, p.nume, p.prenume,
           case when p.data_nasterii is null then null
                else extract(year from age((select d from azi), p.data_nasterii))::int end as varsta,
           count(r.*)::int as meciuri,
           (count(r.*) filter (where r.pentru > r.contra))::int as victorii,
           (count(r.*) filter (where r.pentru < r.contra))::int as infrangeri,
           case when p.acord_date_personale and p.foto_path is not null then p.foto_path end as foto_path,
           -- games after midnight belong to the evening session of `data`, so they sort after its evening games
           jsonb_agg(jsonb_build_object('meci', r.meci, 'data', r.data, 'ora', to_char(r.ora, 'HH24:MI'),
                                        'pentru', r.pentru, 'contra', r.contra)
                     order by r.data desc, (r.ora < time '06:00') desc, r.ora desc) as jocuri
      from public.participanti p
      join r on r.pid = p.id
     group by p.id
  )
  select jsonb_build_object(
    'generat_la', now(),
    'jucatori', coalesce(jsonb_agg(jsonb_build_object(
      'id', j.id, 'nume', j.nume, 'prenume', j.prenume, 'varsta', j.varsta,
      'meciuri', j.meciuri, 'victorii', j.victorii, 'infrangeri', j.infrangeri,
      'foto_path', j.foto_path, 'jocuri', j.jocuri) order by j.nume, j.prenume), '[]'::jsonb))
  from j;
$$;
revoke execute on function public.export_site_attp() from public, anon, authenticated;
grant execute on function public.export_site_attp() to service_role;
