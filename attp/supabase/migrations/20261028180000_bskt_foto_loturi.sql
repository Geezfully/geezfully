-- Photos are copied at most 8 per run. The copy step (edge fn bskt-photos) takes ~2-3 s a photo and the sync's call
-- is cut at 60 s; an interrupted call records nothing, so when the export grew from 3 to 54 photos (28.10.2026) the
-- unbounded batch restarted from the top every run and never finished. The log shows how many are still pending.

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
  n_j int; n_g int; n_f int := 0; n_rest int := 0;
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
      insert into bskt_sync_log (ok, jucatori, jocuri, eroare)
      values (false, n_j, n_g, 'bskt-photos HTTP ' || resp.status || ': ' || left(resp.content, 300));
    end if;
  end if;

  insert into bskt_sync_log (ok, jucatori, jocuri, fotografii, eroare)
  values (true, n_j, n_g, n_f, case when n_rest > n_f then (n_rest - n_f) || ' photos still to copy' end);
  delete from bskt_sync_log where la < now() - interval '30 days';
  return jsonb_build_object('ok', true, 'jucatori', n_j, 'jocuri', n_g, 'fotografii', n_f, 'foto_ramase', greatest(n_rest - n_f, 0));
end
$$;
revoke execute on function public.sync_bskt() from public, anon, authenticated;
