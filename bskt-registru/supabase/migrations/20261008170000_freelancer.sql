-- Freelancer flag on players and referees (default ON = everyone as before).
--   freelancer = true  → officially registered; pays the 15% tax itself, so the company pays the GROSS
--                        (net ÷ (1 − 15%)) and the person keeps the net;
--   freelancer = false → taxes handled another way; the company pays the NET only.
-- Either way the person ends up with the same net (e.g. 80 MDL/h for a referee).
-- The admin and the helper (asistent) can change it; helper changes are logged and undoable.

alter table public.participanti add column if not exists freelancer boolean not null default true;
alter table public.arbitri add column if not exists freelancer boolean not null default true;

-- helper views of players / referees now include the flag
drop function if exists public.participanti_asistent();
create function public.participanti_asistent()
returns table (id uuid, nume text, prenume text, echipa_id uuid, nr_echipa smallint, rol_echipa text,
               rating integer, categorie_sportiva text, foto_path text, statut text,
               eligibil_antrenament boolean, data_inregistrarii date, created_at timestamptz,
               data_aviz_medical date, nr_dulap text, marime text, freelancer boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.nume, p.prenume, p.echipa_id, p.nr_echipa, p.rol_echipa, p.rating, p.categorie_sportiva,
         p.foto_path, p.statut, p.eligibil_antrenament, p.data_inregistrarii, p.created_at,
         p.data_aviz_medical, p.nr_dulap, p.marime, p.freelancer
    from public.participanti p
   where public.is_administrator()
   order by p.created_at desc;
$$;
revoke execute on function public.participanti_asistent() from public, anon;
grant execute on function public.participanti_asistent() to authenticated;

drop function if exists public.arbitri_asistent();
create function public.arbitri_asistent()
returns table (id uuid, nume text, prenume text, statut text, data_inregistrarii date, created_at timestamptz, freelancer boolean)
language sql stable security definer set search_path = public as $$
  select a.id, a.nume, a.prenume, a.statut, a.data_inregistrarii, a.created_at, a.freelancer
    from public.arbitri a
   where public.is_administrator()
   order by a.created_at desc;
$$;
revoke execute on function public.arbitri_asistent() from public, anon;
grant execute on function public.arbitri_asistent() to authenticated;

-- the helper's write path may now also touch arbitri (only through asistent_salveaza_arbitru)
create or replace function public.blocheaza_scriere_asistent()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_asistent() then
    if coalesce(current_setting('bskt.asistent_meci', true), '') = 'on'
       and tg_table_name in ('meciuri', 'meci_jucatori', 'participanti', 'arbitri', 'jurnal') and tg_op <> 'TRUNCATE' then
      return null;
    end if;
    raise exception 'Contul de asistent are doar drept de citire (% pe %)', tg_op, tg_table_name
      using errcode = '42501';
  end if;
  return null;
end; $$;

alter table public.modificari_asistent drop constraint if exists modificari_asistent_tip_check;
alter table public.modificari_asistent add constraint modificari_asistent_tip_check check (tip in ('meci', 'echipa', 'jucator', 'arbitru'));

create or replace function public._snapshot_jucatori(p uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'echipa_id', x.echipa_id, 'nr_echipa', x.nr_echipa, 'rol_echipa', x.rol_echipa,
                    'statut', x.statut, 'data_aviz_medical', x.data_aviz_medical, 'nr_dulap', x.nr_dulap, 'freelancer', x.freelancer) order by x.id), '[]'::jsonb)
    from public.participanti x where x.id = any(p);
$$;
create or replace function public._snapshot_arbitru(p uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('id', a.id, 'freelancer', a.freelancer) from public.arbitri a where a.id = p), '{}'::jsonb);
$$;
revoke execute on function public._snapshot_jucatori(uuid[]) from public, anon, authenticated;
revoke execute on function public._snapshot_arbitru(uuid) from public, anon, authenticated;

drop function if exists public.asistent_salveaza_jucator(uuid, text, date, text, text);
create function public.asistent_salveaza_jucator(
  p_id uuid, p_statut text, p_aviz date, p_dulap text, p_freelancer boolean default null, p_rezumat text default null)
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
  update public.participanti set statut = p_statut, data_aviz_medical = p_aviz, nr_dulap = nullif(trim(p_dulap), ''),
         freelancer = coalesce(p_freelancer, freelancer)
   where id = p_id;
  if public._snapshot_jucatori(array[p_id]) = v_before then perform set_config('bskt.asistent_meci', 'off', true); return; end if;
  insert into public.modificari_asistent (grup, autor_id, tip, obiect_id, jucatori, actiune, inainte, dupa, dupa_cheie, rezumat)
  values (gen_random_uuid(), auth.uid(), 'jucator', p_id, array[p_id], 'modificat',
          v_before, public._snapshot_jucatori(array[p_id]), md5(public._snapshot_jucatori(array[p_id])::text), left(p_rezumat, 2000));
  insert into public.jurnal (administrator_id, actiune)
  values (auth.uid(), 'Asistent: ' || coalesce(left(p_rezumat, 500), 'a modificat datele unui jucător'));
  perform set_config('bskt.asistent_meci', 'off', true);
end; $$;
revoke execute on function public.asistent_salveaza_jucator(uuid, text, date, text, boolean, text) from public, anon;
grant execute on function public.asistent_salveaza_jucator(uuid, text, date, text, boolean, text) to authenticated;

create or replace function public.asistent_salveaza_arbitru(p_id uuid, p_freelancer boolean, p_rezumat text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not public.is_asistent() then
    raise exception 'Funcție rezervată contului de asistent' using errcode = '42501';
  end if;
  if p_freelancer is null then raise exception 'Valoare invalidă'; end if;
  v_before := public._snapshot_arbitru(p_id);
  if v_before = '{}'::jsonb then raise exception 'Arbitrul nu există'; end if;
  if (v_before->>'freelancer')::boolean = p_freelancer then return; end if;
  perform set_config('bskt.asistent_meci', 'on', true);
  update public.arbitri set freelancer = p_freelancer where id = p_id;
  insert into public.modificari_asistent (grup, autor_id, tip, obiect_id, actiune, inainte, dupa, dupa_cheie, rezumat)
  values (gen_random_uuid(), auth.uid(), 'arbitru', p_id, 'modificat',
          v_before, public._snapshot_arbitru(p_id), md5(public._snapshot_arbitru(p_id)::text), left(p_rezumat, 2000));
  insert into public.jurnal (administrator_id, actiune)
  values (auth.uid(), 'Asistent: ' || coalesce(left(p_rezumat, 500), 'a modificat statutul de freelancer al unui arbitru'));
  perform set_config('bskt.asistent_meci', 'off', true);
end; $$;
revoke execute on function public.asistent_salveaza_arbitru(uuid, boolean, text) from public, anon;
grant execute on function public.asistent_salveaza_arbitru(uuid, boolean, text) to authenticated;

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
       or (rec.tip in ('echipa', 'jucator') and md5(public._snapshot_jucatori(rec.jucatori)::text) <> rec.dupa_cheie)
       or (rec.tip = 'arbitru' and md5(public._snapshot_arbitru(rec.obiect_id)::text) <> rec.dupa_cheie) then
      raise exception '%', case when rec.tip = 'meci'
        then 'Meciul din ' || coalesce(to_char((rec.dupa->'meci'->>'data')::date, 'DD.MM.YYYY'), '?') || ' a fost modificat după schimbarea asistentului — corectați-l manual din editorul meciului.'
        else 'Datele au fost modificate după schimbarea asistentului — corectați-le manual.' end;
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
    elsif rec.tip = 'arbitru' then
      update public.arbitri set freelancer = coalesce((rec.inainte->>'freelancer')::boolean, freelancer) where id = rec.obiect_id;
    else
      for x in select * from jsonb_array_elements(rec.inainte) loop
        update public.participanti set echipa_id = (x->>'echipa_id')::uuid, nr_echipa = (x->>'nr_echipa')::smallint,
               rol_echipa = x->>'rol_echipa', statut = x->>'statut',
               data_aviz_medical = (x->>'data_aviz_medical')::date, nr_dulap = x->>'nr_dulap',
               freelancer = coalesce((x->>'freelancer')::boolean, freelancer)
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
