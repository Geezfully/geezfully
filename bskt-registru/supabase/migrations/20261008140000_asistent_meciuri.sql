-- Helper (asistent) may add matches, edit match line-ups, edit team line-ups (players, number,
-- captain/player role — not team name/colour/status) and a player's status, medical date and locker. Safely:
--  * only through asistent_salveaza_meci() — direct table writes stay blocked;
--  * only for matches dated from Monday of the previous week up to 30 days ahead;
--  * matches synced from 3x3.bsktcup.com keep date, time, teams and score (the site owns them);
--  * no deleting matches;
--  * team / player edits only through asistent_salveaza_echipa() / asistent_salveaza_jucator();
--  * every save stores a before/after snapshot in modificari_asistent, and an admin can undo
--    a whole save with anuleaza_modificari_asistent() (refused if the data changed since).

create or replace function public.asistent_fereastra_start()
returns date language sql stable set search_path = public as $$
  select (date_trunc('week', public.moldova_today()::timestamp))::date - 7;
$$;
grant execute on function public.asistent_fereastra_start() to authenticated;

-- the statement-level write block lets the helper's own RPC through (transaction-local flag, switched
-- on at the start of each helper function and off again before it returns)
create or replace function public.blocheaza_scriere_asistent()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_asistent() then
    if coalesce(current_setting('bskt.asistent_meci', true), '') = 'on'
       and tg_table_name in ('meciuri', 'meci_jucatori', 'participanti', 'jurnal') and tg_op <> 'TRUNCATE' then
      return null;
    end if;
    raise exception 'Contul de asistent are doar drept de citire (% pe %)', tg_op, tg_table_name
      using errcode = '42501';
  end if;
  return null;
end; $$;

create table if not exists public.modificari_asistent (
  id bigint generated always as identity primary key,
  grup uuid not null,
  creat_la timestamptz not null default now(),
  autor_id uuid references public.administratori(id) on delete set null,
  tip text not null check (tip in ('meci', 'echipa', 'jucator')),
  obiect_id uuid not null,                -- match / team / player id
  jucatori uuid[],                        -- for 'echipa'/'jucator': every player whose row was snapshotted
  actiune text not null check (actiune in ('adaugat', 'modificat')),
  inainte jsonb,
  dupa jsonb not null,
  dupa_cheie text not null,
  rezumat text,
  anulat_la timestamptz,
  anulat_de uuid references public.administratori(id) on delete set null
);
create index if not exists modificari_asistent_creat_la on public.modificari_asistent (creat_la desc);
create index if not exists modificari_asistent_grup on public.modificari_asistent (grup);
alter table public.modificari_asistent enable row level security;
drop policy if exists "modificari_asistent: citire" on public.modificari_asistent;
create policy "modificari_asistent: citire" on public.modificari_asistent for select to authenticated
  using ((select public.is_full_admin()) or autor_id = (select auth.uid()));

-- full snapshot (for display and restore) and a fingerprint of what the helper can change
create or replace function public._snapshot_meci(p uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'meci', (select to_jsonb(m) - 'created_at' - 'sincronizat_la' from public.meciuri m where m.id = p),
    'lot', coalesce((select jsonb_agg(jsonb_build_object('echipa_id', j.echipa_id, 'participant_id', j.participant_id,
                       'rol', j.rol, 'suma_net', j.suma_net, 'suma_bruta', j.suma_bruta) order by j.echipa_id, j.participant_id)
                     from public.meci_jucatori j where j.meci_id = p), '[]'::jsonb));
$$;
create or replace function public._cheie_meci(p uuid)
returns text language sql stable security definer set search_path = public as $$
  select md5(coalesce((
    select jsonb_build_object(
      'detalii', jsonb_build_object('nr', m.nr, 'teren', m.teren, 'arbitru', m.arbitru, 'observatii', m.observatii, 'prelungiri', m.prelungiri)
        || case when m.sursa = 'manual' and m.id_extern is null
                then jsonb_build_object('data', m.data, 'ora', m.ora, 'a', m.echipa_a_id, 'b', m.echipa_b_id, 'sa', m.scor_a, 'sb', m.scor_b)
                else '{}'::jsonb end,
      'lot', coalesce((select jsonb_agg(jsonb_build_array(j.echipa_id, j.participant_id, j.rol) order by j.echipa_id, j.participant_id)
                       from public.meci_jucatori j where j.meci_id = m.id), '[]'::jsonb))::text
    from public.meciuri m where m.id = p), 'sters'));
$$;
create or replace function public._snapshot_jucatori(p uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'echipa_id', x.echipa_id, 'nr_echipa', x.nr_echipa, 'rol_echipa', x.rol_echipa,
                    'statut', x.statut, 'data_aviz_medical', x.data_aviz_medical, 'nr_dulap', x.nr_dulap) order by x.id), '[]'::jsonb)
    from public.participanti x where x.id = any(p);
$$;
revoke execute on function public._snapshot_jucatori(uuid[]) from public, anon, authenticated;
revoke execute on function public._snapshot_meci(uuid) from public, anon, authenticated;
revoke execute on function public._cheie_meci(uuid) from public, anon, authenticated;

create or replace function public.asistent_salveaza_meci(
  p_meci_id uuid, p_meci jsonb, p_lot jsonb, p_grup uuid default null, p_rezumat text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_start date := public.asistent_fereastra_start();
  v_max date := public.moldova_today() + 30;
  v_old public.meciuri%rowtype;
  v_id uuid;
  v_before jsonb;
  v_data date;
  v_synced boolean;
begin
  if not public.is_asistent() then
    raise exception 'Funcție rezervată contului de asistent' using errcode = '42501';
  end if;
  perform set_config('bskt.asistent_meci', 'on', true);

  if p_lot is not null and jsonb_typeof(p_lot) <> 'array' then raise exception 'Lot invalid'; end if;

  if p_meci_id is null then
    if p_meci is null then raise exception 'Lipsesc datele meciului'; end if;
    v_data := nullif(p_meci->>'data', '')::date;
    if v_data is null or v_data < v_start or v_data > v_max then
      raise exception 'Asistentul poate adăuga meciuri doar între % și %', to_char(v_start, 'DD.MM.YYYY'), to_char(v_max, 'DD.MM.YYYY');
    end if;
    insert into public.meciuri (nr, data, ora, teren, echipa_a_id, echipa_b_id, scor_a, scor_b, prelungiri, arbitru, observatii, sursa)
    values (nullif(p_meci->>'nr', '')::int, v_data, nullif(p_meci->>'ora', '')::time, nullif(p_meci->>'teren', ''),
            (p_meci->>'echipa_a_id')::uuid, (p_meci->>'echipa_b_id')::uuid,
            nullif(p_meci->>'scor_a', '')::int, nullif(p_meci->>'scor_b', '')::int,
            coalesce((p_meci->>'prelungiri')::boolean, false), nullif(p_meci->>'arbitru', ''), nullif(p_meci->>'observatii', ''), 'manual')
    returning id into v_id;
  else
    select * into v_old from public.meciuri where id = p_meci_id for update;
    if not found then raise exception 'Meciul nu mai există'; end if;
    if v_old.data < v_start or v_old.data > v_max then
      raise exception 'Asistentul poate modifica doar meciurile din % până la %', to_char(v_start, 'DD.MM.YYYY'), to_char(v_max, 'DD.MM.YYYY');
    end if;
    v_id := p_meci_id;
    v_before := public._snapshot_meci(v_id);
    v_synced := v_old.sursa <> 'manual' or v_old.id_extern is not null;
    -- the pay trigger refuses players whose team is not in the match: clear the line-up first
    if p_lot is not null then delete from public.meci_jucatori where meci_id = v_id; end if;
    if p_meci is not null then
      if v_synced then
        update public.meciuri set nr = nullif(p_meci->>'nr', '')::int, teren = nullif(p_meci->>'teren', ''),
               arbitru = nullif(p_meci->>'arbitru', ''), observatii = nullif(p_meci->>'observatii', ''),
               prelungiri = coalesce((p_meci->>'prelungiri')::boolean, v_old.prelungiri)
         where id = v_id;
      else
        v_data := nullif(p_meci->>'data', '')::date;
        if v_data is null or v_data < v_start or v_data > v_max then
          raise exception 'Data meciului trebuie să fie între % și %', to_char(v_start, 'DD.MM.YYYY'), to_char(v_max, 'DD.MM.YYYY');
        end if;
        update public.meciuri set nr = nullif(p_meci->>'nr', '')::int, data = v_data, ora = nullif(p_meci->>'ora', '')::time,
               teren = nullif(p_meci->>'teren', ''), echipa_a_id = (p_meci->>'echipa_a_id')::uuid, echipa_b_id = (p_meci->>'echipa_b_id')::uuid,
               scor_a = nullif(p_meci->>'scor_a', '')::int, scor_b = nullif(p_meci->>'scor_b', '')::int,
               prelungiri = coalesce((p_meci->>'prelungiri')::boolean, false),
               arbitru = nullif(p_meci->>'arbitru', ''), observatii = nullif(p_meci->>'observatii', '')
         where id = v_id;
      end if;
    end if;
  end if;

  if p_lot is not null and jsonb_array_length(p_lot) > 0 then
    insert into public.meci_jucatori (meci_id, echipa_id, participant_id, rol)
    select v_id, (x->>'echipa_id')::uuid, (x->>'participant_id')::uuid, coalesce(nullif(x->>'rol', ''), 'jucător')
      from jsonb_array_elements(p_lot) x;
  end if;

  insert into public.modificari_asistent (grup, autor_id, tip, obiect_id, actiune, inainte, dupa, dupa_cheie, rezumat)
  values (coalesce(p_grup, gen_random_uuid()), auth.uid(), 'meci', v_id, case when p_meci_id is null then 'adaugat' else 'modificat' end,
          v_before, public._snapshot_meci(v_id), public._cheie_meci(v_id), left(p_rezumat, 2000));
  insert into public.jurnal (administrator_id, actiune)
  values (auth.uid(), 'Asistent: ' || coalesce(left(p_rezumat, 500), case when p_meci_id is null then 'a adăugat un meci' else 'a modificat un meci' end));
  perform set_config('bskt.asistent_meci', 'off', true);
  return v_id;
end; $$;
revoke execute on function public.asistent_salveaza_meci(uuid, jsonb, jsonb, uuid, text) from public, anon;
grant execute on function public.asistent_salveaza_meci(uuid, jsonb, jsonb, uuid, text) to authenticated;

create or replace function public.asistent_salveaza_echipa(
  p_echipa_id uuid, p_lot jsonb, p_scosi uuid[] default '{}', p_grup uuid default null, p_rezumat text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_before jsonb;
  v_n int := 0;
  x jsonb;
begin
  if not public.is_asistent() then
    raise exception 'Funcție rezervată contului de asistent' using errcode = '42501';
  end if;
  if not exists (select 1 from public.echipe where id = p_echipa_id) then raise exception 'Echipa nu există'; end if;
  if p_lot is null or jsonb_typeof(p_lot) <> 'array' then raise exception 'Lot invalid'; end if;
  perform set_config('bskt.asistent_meci', 'on', true);
  v_ids := array(select distinct u from (
             select (e->>'participant_id')::uuid u from jsonb_array_elements(p_lot) e
             union select unnest(coalesce(p_scosi, '{}'))) q where u is not null);
  v_before := public._snapshot_jucatori(v_ids);
  -- removed players lose team, number and captaincy (only if they are still in this team)
  update public.participanti set echipa_id = null, nr_echipa = null,
         rol_echipa = case when rol_echipa = 'arbitru' then 'arbitru' else 'jucător' end
   where id = any(coalesce(p_scosi, '{}')) and echipa_id = p_echipa_id;
  get diagnostics v_n = row_count;
  for x in select * from jsonb_array_elements(p_lot) loop
    if coalesce(x->>'rol_echipa', 'jucător') not in ('căpitan', 'jucător', 'arbitru') then raise exception 'Rol invalid'; end if;
    if nullif(x->>'nr_echipa', '') is not null and (x->>'nr_echipa')::int not between 1 and 99 then raise exception 'Număr invalid'; end if;
    update public.participanti set echipa_id = p_echipa_id, nr_echipa = nullif(x->>'nr_echipa', '')::smallint,
           rol_echipa = coalesce(nullif(x->>'rol_echipa', ''), 'jucător')
     where id = (x->>'participant_id')::uuid
       and (echipa_id is distinct from p_echipa_id or nr_echipa is distinct from nullif(x->>'nr_echipa', '')::smallint
            or rol_echipa is distinct from coalesce(nullif(x->>'rol_echipa', ''), 'jucător'));
    v_n := v_n + (case when found then 1 else 0 end);
  end loop;
  if v_n > 0 then
    insert into public.modificari_asistent (grup, autor_id, tip, obiect_id, jucatori, actiune, inainte, dupa, dupa_cheie, rezumat)
    values (coalesce(p_grup, gen_random_uuid()), auth.uid(), 'echipa', p_echipa_id, v_ids, 'modificat',
            v_before, public._snapshot_jucatori(v_ids), md5(public._snapshot_jucatori(v_ids)::text), left(p_rezumat, 2000));
    insert into public.jurnal (administrator_id, actiune)
    values (auth.uid(), 'Asistent: ' || coalesce(left(p_rezumat, 500), 'a modificat lotul unei echipe'));
  end if;
  perform set_config('bskt.asistent_meci', 'off', true);
  return v_n;
end; $$;
revoke execute on function public.asistent_salveaza_echipa(uuid, jsonb, uuid[], uuid, text) from public, anon;
grant execute on function public.asistent_salveaza_echipa(uuid, jsonb, uuid[], uuid, text) to authenticated;

create or replace function public.asistent_salveaza_jucator(
  p_id uuid, p_statut text, p_aviz date, p_dulap text, p_rezumat text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not public.is_asistent() then
    raise exception 'Funcție rezervată contului de asistent' using errcode = '42501';
  end if;
  if p_statut not in ('activ', 'inactiv') then raise exception 'Statut invalid'; end if;
  if p_aviz is not null and (p_aviz > public.moldova_today() or p_aviz < public.moldova_today() - 366) then
    raise exception 'Data avizului medical trebuie să fie din ultimul an, nu din viitor';
  end if;
  perform set_config('bskt.asistent_meci', 'on', true);
  v_before := public._snapshot_jucatori(array[p_id]);
  if v_before = '[]'::jsonb then raise exception 'Jucătorul nu există'; end if;
  update public.participanti set statut = p_statut, data_aviz_medical = p_aviz, nr_dulap = nullif(trim(p_dulap), '')
   where id = p_id;
  if public._snapshot_jucatori(array[p_id]) = v_before then perform set_config('bskt.asistent_meci', 'off', true); return; end if;
  insert into public.modificari_asistent (grup, autor_id, tip, obiect_id, jucatori, actiune, inainte, dupa, dupa_cheie, rezumat)
  values (gen_random_uuid(), auth.uid(), 'jucator', p_id, array[p_id], 'modificat',
          v_before, public._snapshot_jucatori(array[p_id]), md5(public._snapshot_jucatori(array[p_id])::text), left(p_rezumat, 2000));
  insert into public.jurnal (administrator_id, actiune)
  values (auth.uid(), 'Asistent: ' || coalesce(left(p_rezumat, 500), 'a modificat datele unui jucător'));
  perform set_config('bskt.asistent_meci', 'off', true);
end; $$;
revoke execute on function public.asistent_salveaza_jucator(uuid, text, date, text, text) from public, anon;
grant execute on function public.asistent_salveaza_jucator(uuid, text, date, text, text) to authenticated;

create or replace function public.anuleaza_modificari_asistent(p_grup uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  rec record;
  v_n int := 0;
  v_m jsonb;
  v_synced boolean;
  x jsonb;
begin
  if not public.is_full_admin() then
    raise exception 'Doar administratorii pot anula modificările asistentului' using errcode = '42501';
  end if;
  -- check everything first so an undo is all-or-nothing and never overwrites a later change
  for rec in select * from public.modificari_asistent where grup = p_grup and anulat_la is null order by id desc loop
    if (rec.tip = 'meci' and public._cheie_meci(rec.obiect_id) <> rec.dupa_cheie)
       or (rec.tip <> 'meci' and md5(public._snapshot_jucatori(rec.jucatori)::text) <> rec.dupa_cheie) then
      raise exception '%', case when rec.tip = 'meci'
        then 'Meciul din ' || coalesce(to_char((rec.dupa->'meci'->>'data')::date, 'DD.MM.YYYY'), '?') || ' a fost modificat după schimbarea asistentului — corectați-l manual din editorul meciului.'
        else 'Datele jucătorilor au fost modificate după schimbarea asistentului — corectați-le manual.' end;
    end if;
  end loop;
  for rec in select * from public.modificari_asistent where grup = p_grup and anulat_la is null order by id desc loop
    if rec.tip = 'meci' and rec.inainte is null then
      delete from public.meciuri where id = rec.obiect_id;
    elsif rec.tip = 'meci' then
      v_m := rec.inainte->'meci';
      v_synced := (v_m->>'sursa') <> 'manual' or (v_m->>'id_extern') is not null;
      delete from public.meci_jucatori where meci_id = rec.obiect_id;
      update public.meciuri set nr = (v_m->>'nr')::int, teren = v_m->>'teren', arbitru = v_m->>'arbitru',
             observatii = v_m->>'observatii', prelungiri = coalesce((v_m->>'prelungiri')::boolean, false)
       where id = rec.obiect_id;
      if not v_synced then
        update public.meciuri set data = (v_m->>'data')::date, ora = (v_m->>'ora')::time,
               echipa_a_id = (v_m->>'echipa_a_id')::uuid, echipa_b_id = (v_m->>'echipa_b_id')::uuid,
               scor_a = (v_m->>'scor_a')::int, scor_b = (v_m->>'scor_b')::int
         where id = rec.obiect_id;
      end if;
      insert into public.meci_jucatori (meci_id, echipa_id, participant_id, rol)
      select rec.obiect_id, (y->>'echipa_id')::uuid, (y->>'participant_id')::uuid, y->>'rol'
        from jsonb_array_elements(rec.inainte->'lot') y;
    else
      for x in select * from jsonb_array_elements(rec.inainte) loop
        update public.participanti set echipa_id = (x->>'echipa_id')::uuid, nr_echipa = (x->>'nr_echipa')::smallint,
               rol_echipa = x->>'rol_echipa', statut = x->>'statut',
               data_aviz_medical = (x->>'data_aviz_medical')::date, nr_dulap = x->>'nr_dulap'
         where id = (x->>'id')::uuid;
      end loop;
    end if;
    update public.modificari_asistent set anulat_la = now(), anulat_de = auth.uid() where id = rec.id;
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    insert into public.jurnal (administrator_id, actiune)
    values (auth.uid(), 'A anulat o modificare a asistentului');
  end if;
  return v_n;
end; $$;
revoke execute on function public.anuleaza_modificari_asistent(uuid) from public, anon;
grant execute on function public.anuleaza_modificari_asistent(uuid) to authenticated;

notify pgrst, 'reload schema';
