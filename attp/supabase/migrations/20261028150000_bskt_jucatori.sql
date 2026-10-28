-- Basketball player profiles on the ATTP website, pulled from the BSKT register (project sbkobwcuywnnmjsbrzqi,
-- edge function export-site). The register decides what is published: name, age, games/wins/losses and each
-- game's date + score — never the team or any other personal field; photos only with the player's consent.
-- The export key lives only in this project's vault ('bskt_export_key'); BSKT stores just its SHA-256.

create table if not exists public.bskt_jucatori (
  id uuid primary key,                       -- BSKT participant id
  nume text not null,
  prenume text not null,
  varsta int,
  meciuri int not null default 0,
  victorii int not null default 0,
  infrangeri int not null default 0,
  foto_versiune text,                        -- BSKT photo file name; changes when the photo is replaced
  foto_url text,                             -- 400px copy in our public bucket player-photos/bskt/
  foto_url_mic text,                         -- 180px copy for lists
  actualizat_la timestamptz not null default now()
);
create table if not exists public.bskt_jocuri (
  jucator_id uuid not null references public.bskt_jucatori(id) on delete cascade,
  meci uuid not null,
  data date not null,
  ora text,
  pentru int not null,
  contra int not null,
  primary key (jucator_id, meci)
);
create index if not exists bskt_jocuri_jucator_data on public.bskt_jocuri (jucator_id, data desc);
create table if not exists public.bskt_sync_log (
  id bigserial primary key,
  la timestamptz not null default now(),
  ok boolean not null,
  jucatori int,
  jocuri int,
  fotografii int,
  eroare text
);

alter table public.bskt_jucatori enable row level security;
alter table public.bskt_jocuri enable row level security;
alter table public.bskt_sync_log enable row level security;
drop policy if exists "bskt_jucatori public read" on public.bskt_jucatori;
create policy "bskt_jucatori public read" on public.bskt_jucatori for select to anon, authenticated using (true);
drop policy if exists "bskt_jocuri public read" on public.bskt_jocuri;
create policy "bskt_jocuri public read" on public.bskt_jocuri for select to anon, authenticated using (true);
-- bskt_sync_log: no policies — only the service role and the sync function read it

-- explicit Data API grants (required for new tables from 30.10.2026)
grant select on public.bskt_jucatori to anon, authenticated;
grant select on public.bskt_jocuri to anon, authenticated;
grant all on public.bskt_jucatori, public.bskt_jocuri, public.bskt_sync_log to service_role;
grant usage, select on sequence public.bskt_sync_log_id_seq to service_role;
revoke all on public.bskt_sync_log from anon, authenticated;
revoke insert, update, delete, truncate on public.bskt_jucatori, public.bskt_jocuri from anon, authenticated;

-- the photo function proves it was called by our sync with the same vault key
create or replace function public.bskt_sync_key_ok(p_key text)
returns boolean language sql stable security definer set search_path = public, vault as $$
  select coalesce(length(p_key) >= 32 and exists (
    select 1 from vault.decrypted_secrets where name = 'bskt_export_key' and decrypted_secret = p_key), false)
$$;
revoke execute on function public.bskt_sync_key_ok(text) from public, anon, authenticated;
grant execute on function public.bskt_sync_key_ok(text) to service_role;

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
  todo jsonb;
  done jsonb;
  n_j int; n_g int; n_f int := 0;
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

  delete from bskt_jocuri;
  insert into bskt_jocuri (jucator_id, meci, data, ora, pentru, contra)
  select (x->>'id')::uuid, (g->>'meci')::uuid, (g->>'data')::date, g->>'ora', (g->>'pentru')::int, (g->>'contra')::int
    from jsonb_array_elements(src) x, jsonb_array_elements(x->'jocuri') g;
  get diagnostics n_g = row_count;
  n_j := jsonb_array_length(src);

  -- photos: consent withdrawn / photo removed → hide now and delete the files; new or replaced → copy
  todo := jsonb_set(todo, '{sterge}', (todo->'sterge') || coalesce((
    select jsonb_agg(j.id) from bskt_jucatori j join jsonb_array_elements(src) x on (x->>'id')::uuid = j.id
     where j.foto_versiune is not null and x->'foto' = 'null'::jsonb), '[]'::jsonb));
  update bskt_jucatori j set foto_versiune = null, foto_url = null, foto_url_mic = null
    from jsonb_array_elements(src) x
   where (x->>'id')::uuid = j.id and j.foto_versiune is not null and x->'foto' = 'null'::jsonb;
  todo := jsonb_set(todo, '{copiaza}', coalesce((
    select jsonb_agg(jsonb_build_object('id', j.id, 'versiune', x->'foto'->>'versiune', 'url', x->'foto'->>'url'))
      from bskt_jucatori j join jsonb_array_elements(src) x on (x->>'id')::uuid = j.id
     where x->'foto' <> 'null'::jsonb and j.foto_versiune is distinct from x->'foto'->>'versiune'), '[]'::jsonb));

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
      insert into bskt_sync_log (ok, jucatori, jocuri, eroare)
      values (false, n_j, n_g, 'bskt-photos HTTP ' || resp.status || ': ' || left(resp.content, 300));
    end if;
  end if;

  insert into bskt_sync_log (ok, jucatori, jocuri, fotografii) values (true, n_j, n_g, n_f);
  delete from bskt_sync_log where la < now() - interval '30 days';
  return jsonb_build_object('ok', true, 'jucatori', n_j, 'jocuri', n_g, 'fotografii', n_f);
end
$$;
revoke execute on function public.sync_bskt() from public, anon, authenticated;

-- every 15 minutes, offset from the Setka (:00/:15/…) and ligas (:05/:20/…) jobs
select cron.schedule('sync-bskt', '7,22,37,52 * * * *', 'select public.sync_bskt();');
