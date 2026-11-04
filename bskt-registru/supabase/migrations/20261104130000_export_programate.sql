-- ATTP website export: also the scheduled Bskt Cup games (no score yet), so the site can show what is coming up.
-- Only the date, time and the two teams go out — never who plays.

create or replace function public.export_site_attp()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  with azi as (select (now() at time zone 'Europe/Chisinau')::date as d),
  r as (
    select mj.participant_id as pid,
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
           nullif(p.foto_path, '') as foto_path
      from public.participanti p
      join r on r.pid = p.id
     group by p.id
  ),
  m as (
    select m.id, m.data, to_char(m.ora, 'HH24:MI') as ora, m.echipa_a_id, m.echipa_b_id, m.scor_a, m.scor_b,
           coalesce(m.prelungiri, false) as prelungiri
      from public.meciuri m
     where m.scor_a is not null and m.scor_b is not null and m.scor_a <> m.scor_b
       and m.echipa_a_id is not null and m.echipa_b_id is not null
  )
  select jsonb_build_object(
    'generat_la', now(),
    'jucatori', coalesce((select jsonb_agg(jsonb_build_object(
      'id', j.id, 'nume', j.nume, 'prenume', j.prenume, 'varsta', j.varsta,
      'meciuri', j.meciuri, 'victorii', j.victorii, 'infrangeri', j.infrangeri,
      'foto_path', j.foto_path) order by j.nume, j.prenume) from j), '[]'::jsonb),
    'echipe', coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'nume', e.nume, 'culoare', e.culoare, 'logo_url', nullif(e.logo_url, ''), 'activ', e.activ)
      order by e.nume)
      from public.echipe e
     where exists (select 1 from m where e.id in (m.echipa_a_id, m.echipa_b_id))), '[]'::jsonb),
    -- games after midnight belong to the evening session of `data`, so they sort after its evening games
    'meciuri', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'data', m.data, 'ora', m.ora, 'echipa_a', m.echipa_a_id, 'echipa_b', m.echipa_b_id,
      'scor_a', m.scor_a, 'scor_b', m.scor_b, 'prelungiri', m.prelungiri)
      order by m.data desc, (m.ora < '06:00') desc, m.ora desc) from m), '[]'::jsonb),
    -- games on the schedule that have no score yet, from yesterday's evening on (a game after midnight
    -- belongs to the evening before)
    'programate', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'data', p.data, 'ora', to_char(p.ora, 'HH24:MI'), 'echipa_a', p.echipa_a_id, 'echipa_b', p.echipa_b_id)
      order by p.data, (p.ora < time '06:00'), p.ora)
      from public.meciuri p
     where (p.scor_a is null or p.scor_b is null)
       and p.echipa_a_id is not null and p.echipa_b_id is not null
       and p.data >= (select d from azi) - 1), '[]'::jsonb));
$function$;
revoke execute on function public.export_site_attp() from public, anon, authenticated;
grant execute on function public.export_site_attp() to service_role;
