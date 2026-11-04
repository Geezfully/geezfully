-- Basketball teams on the website (Jucători → Baschet → Echipe). The BSKT register's export (export-site) now
-- carries the teams and every scored match between two teams, and no longer a per-game list for players: with
-- both, any player's game would match exactly one team match and reveal who plays where. Players keep their totals.
--
--   bskt_echipe   name, colour, logo of every team that has played
--   bskt_meciuri  every scored match: date, time, the two teams, score, overtime (never a player)
--   bskt_echipe_h2h   per team and opponent: matches, wins, losses, points for and against
--   bskt_echipe_stat  per team: the same totals, plus `coeficient` = the average, over every opponent faced, of the
--                     share of games won against that opponent (each opponent counts once, however often they met)

create table if not exists public.bskt_echipe (
  id uuid primary key,
  nume text not null,
  culoare text,
  logo_url text,
  activ boolean not null default true,
  actualizat_la timestamptz not null default now()
);

create table if not exists public.bskt_meciuri (
  id uuid primary key,
  data date not null,
  ora text,
  echipa_a uuid not null references public.bskt_echipe (id) on delete cascade,
  echipa_b uuid not null references public.bskt_echipe (id) on delete cascade,
  scor_a int not null,
  scor_b int not null,
  prelungiri boolean not null default false
);
create index if not exists bskt_meciuri_data on public.bskt_meciuri (data desc, ora desc);
create index if not exists bskt_meciuri_a on public.bskt_meciuri (echipa_a);
create index if not exists bskt_meciuri_b on public.bskt_meciuri (echipa_b);

alter table public.bskt_echipe enable row level security;
alter table public.bskt_meciuri enable row level security;
drop policy if exists "bskt_echipe public read" on public.bskt_echipe;
create policy "bskt_echipe public read" on public.bskt_echipe for select to anon, authenticated using (true);
drop policy if exists "bskt_meciuri public read" on public.bskt_meciuri;
create policy "bskt_meciuri public read" on public.bskt_meciuri for select to anon, authenticated using (true);
grant select on public.bskt_echipe, public.bskt_meciuri to anon, authenticated;
grant all on public.bskt_echipe, public.bskt_meciuri to service_role;
revoke insert, update, delete, truncate on public.bskt_echipe, public.bskt_meciuri from anon, authenticated;

alter table public.bskt_sync_log add column if not exists echipe int, add column if not exists meciuri int;

create or replace view public.bskt_echipe_h2h with (security_invoker = on) as
  with s as (
    select echipa_a as echipa, echipa_b as adversar, scor_a as pentru, scor_b as contra from public.bskt_meciuri
    union all
    select echipa_b, echipa_a, scor_b, scor_a from public.bskt_meciuri
  )
  select echipa, adversar,
         count(*)::int as meciuri,
         (count(*) filter (where pentru > contra))::int as victorii,
         (count(*) filter (where pentru < contra))::int as infrangeri,
         sum(pentru)::int as puncte_pentru,
         sum(contra)::int as puncte_contra
    from s group by echipa, adversar;

create or replace view public.bskt_echipe_stat with (security_invoker = on) as
  select e.id, e.nume, e.culoare, e.logo_url,
         coalesce(sum(h.meciuri), 0)::int as meciuri,
         coalesce(sum(h.victorii), 0)::int as victorii,
         coalesce(sum(h.infrangeri), 0)::int as infrangeri,
         coalesce(sum(h.puncte_pentru), 0)::int as puncte_pentru,
         coalesce(sum(h.puncte_contra), 0)::int as puncte_contra,
         count(h.adversar)::int as adversari,
         round(avg(h.victorii::numeric / nullif(h.meciuri, 0)), 3) as coeficient
    from public.bskt_echipe e
    left join public.bskt_echipe_h2h h on h.echipa = e.id
   group by e.id;

grant select on public.bskt_echipe_h2h, public.bskt_echipe_stat to anon, authenticated;
grant select on public.bskt_echipe_h2h, public.bskt_echipe_stat to service_role;

-- The sync: players as before (totals and photos), plus teams and matches. The old per-game table
-- (bskt_jocuri) is no longer written; it is dropped once the website no longer reads it.
create or replace function public.sync_bskt()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  k text;
  resp extensions.http_response;
  body jsonb;
  src jsonb;
  t_src jsonb;
  m_src jsonb;
  todo jsonb;
  done jsonb;
  n_j int; n_e int; n_m int; n_f int := 0; n_rest int := 0;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'bskt_export_key';
  if k is null then
    insert into bskt_sync_log (ok, eroare) values (false, 'vault secret bskt_export_key missing');
    return jsonb_build_object('ok', false, 'eroare', 'no key');
  end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '60');
  select * into resp from extensions.http((
    'GET', 'https://sbkobwcuywnnmjsbrzqi.supabase.co/functions/v1/export-site',
    array[extensions.http_header('x-export-key', k)], null, null)::extensions.http_request);
  if resp.status <> 200 then
    insert into bskt_sync_log (ok, eroare) values (false, 'export-site HTTP ' || resp.status || ': ' || left(resp.content, 300));
    return jsonb_build_object('ok', false, 'status', resp.status);
  end if;

  body := resp.content::jsonb;
  src := body -> 'jucatori';
  t_src := body -> 'echipe';
  m_src := body -> 'meciuri';
  -- a broken or empty answer must never wipe the site
  if jsonb_typeof(src) <> 'array' or (jsonb_array_length(src) = 0 and exists (select 1 from bskt_jucatori)) then
    insert into bskt_sync_log (ok, eroare) values (false, 'empty or malformed export, nothing changed');
    return jsonb_build_object('ok', false, 'eroare', 'empty export');
  end if;

  insert into bskt_jucatori (id, nume, prenume, varsta, meciuri, victorii, infrangeri, actualizat_la)
  select (x->>'id')::uuid, x->>'nume', x->>'prenume', (x->>'varsta')::int,
         (x->>'meciuri')::int, (x->>'victorii')::int, (x->>'infrangeri')::int, now()
    from jsonb_array_elements(src) x
  on conflict (id) do update set nume = excluded.nume, prenume = excluded.prenume, varsta = excluded.varsta,
    meciuri = excluded.meciuri, victorii = excluded.victorii, infrangeri = excluded.infrangeri, actualizat_la = now();

  -- players no longer in the export disappear from the site; remember their photos so the files go too
  todo := jsonb_build_object('copiaza', '[]'::jsonb, 'sterge',
    coalesce((select jsonb_agg(id) from bskt_jucatori
               where foto_versiune is not null and id not in (select (x->>'id')::uuid from jsonb_array_elements(src) x)), '[]'::jsonb));
  delete from bskt_jucatori where id not in (select (x->>'id')::uuid from jsonb_array_elements(src) x);
  n_j := jsonb_array_length(src);

  -- teams and matches; same rule: an empty or missing list never wipes what the site already shows
  if jsonb_typeof(t_src) = 'array' and jsonb_array_length(t_src) > 0
     and jsonb_typeof(m_src) = 'array' and jsonb_array_length(m_src) > 0 then
    insert into bskt_echipe (id, nume, culoare, logo_url, activ, actualizat_la)
    select (x->>'id')::uuid, x->>'nume', x->>'culoare', x->>'logo_url', coalesce((x->>'activ')::boolean, true), now()
      from jsonb_array_elements(t_src) x
    on conflict (id) do update set nume = excluded.nume, culoare = excluded.culoare, logo_url = excluded.logo_url,
      activ = excluded.activ, actualizat_la = now();
    delete from bskt_meciuri;
    delete from bskt_echipe where id not in (select (x->>'id')::uuid from jsonb_array_elements(t_src) x);
    insert into bskt_meciuri (id, data, ora, echipa_a, echipa_b, scor_a, scor_b, prelungiri)
    select (x->>'id')::uuid, (x->>'data')::date, x->>'ora', (x->>'echipa_a')::uuid, (x->>'echipa_b')::uuid,
           (x->>'scor_a')::int, (x->>'scor_b')::int, coalesce((x->>'prelungiri')::boolean, false)
      from jsonb_array_elements(m_src) x
     where (x->>'echipa_a')::uuid in (select id from bskt_echipe) and (x->>'echipa_b')::uuid in (select id from bskt_echipe);
    get diagnostics n_m = row_count;
    n_e := jsonb_array_length(t_src);
  end if;

  -- photos: consent withdrawn / photo removed → hide now and delete the files; new or replaced → copy
  todo := jsonb_set(todo, '{sterge}', (todo->'sterge') || coalesce((
    select jsonb_agg(j.id) from bskt_jucatori j join jsonb_array_elements(src) x on (x->>'id')::uuid = j.id
     where j.foto_versiune is not null and x->'foto' = 'null'::jsonb), '[]'::jsonb));
  update bskt_jucatori j set foto_versiune = null, foto_url = null, foto_url_mic = null
    from jsonb_array_elements(src) x
   where (x->>'id')::uuid = j.id and j.foto_versiune is not null and x->'foto' = 'null'::jsonb;
  -- at most 8 photos per run: the copy step takes ~2-3 s a photo and the call is cut at 60 s, and an interrupted
  -- call records nothing, so an unbounded batch (51 at once on 28.10) restarted from the top forever. The rest
  -- follow on the next runs.
  select count(*) into n_rest
    from bskt_jucatori j join jsonb_array_elements(src) x on (x->>'id')::uuid = j.id
   where x->'foto' <> 'null'::jsonb and j.foto_versiune is distinct from x->'foto'->>'versiune';
  todo := jsonb_set(todo, '{copiaza}', coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id, 'versiune', t.versiune, 'url', t.url))
      from (select j.id, x->'foto'->>'versiune' as versiune, x->'foto'->>'url' as url
              from bskt_jucatori j join jsonb_array_elements(src) x on (x->>'id')::uuid = j.id
             where x->'foto' <> 'null'::jsonb and j.foto_versiune is distinct from x->'foto'->>'versiune'
             order by j.nume, j.prenume
             limit 8) t), '[]'::jsonb));

  if jsonb_array_length(todo->'copiaza') > 0 or jsonb_array_length(todo->'sterge') > 0 then
    select * into resp from extensions.http((
      'POST', 'https://bghrgacqcqwdiqegkowd.supabase.co/functions/v1/bskt-photos',
      array[extensions.http_header('x-sync-key', k)], 'application/json', todo::text)::extensions.http_request);
    if resp.status = 200 then
      done := resp.content::jsonb -> 'copiate';
      update bskt_jucatori j set foto_versiune = d->>'versiune', foto_url = d->>'url', foto_url_mic = d->>'url_mic'
        from jsonb_array_elements(coalesce(done, '[]'::jsonb)) d where j.id = (d->>'id')::uuid;
      n_f := coalesce(jsonb_array_length(done), 0);
    else
      insert into bskt_sync_log (ok, jucatori, echipe, meciuri, eroare)
      values (false, n_j, n_e, n_m, 'bskt-photos HTTP ' || resp.status || ': ' || left(resp.content, 300));
    end if;
  end if;

  insert into bskt_sync_log (ok, jucatori, echipe, meciuri, fotografii, eroare)
  values (true, n_j, n_e, n_m, n_f, nullif(concat_ws('; ',
    case when n_rest > n_f then (n_rest - n_f) || ' photos still to copy' end,
    case when n_e is null then 'no teams in the export, teams left as they were' end), ''));
  delete from bskt_sync_log where la < now() - interval '30 days';
  return jsonb_build_object('ok', true, 'jucatori', n_j, 'echipe', n_e, 'meciuri', n_m, 'fotografii', n_f,
                            'foto_ramase', greatest(n_rest - n_f, 0));
end
$$;
revoke execute on function public.sync_bskt() from public, anon, authenticated;
