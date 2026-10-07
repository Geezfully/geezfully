-- BSKT Pontaj — permission helpers, business logic, triggers, RLS, storage

-- ───────────────────────── permission helpers ─────────────────────────
create or replace function public.is_administrator() returns boolean language sql stable security definer set search_path=public
as $$ select exists (select 1 from public.administratori where id = auth.uid()); $$;
create or replace function public.is_full_admin() returns boolean language sql stable security definer set search_path=public
as $$ select exists (select 1 from public.administratori where id = auth.uid() and rol = 'admin'); $$;
create or replace function public.can_edit_register() returns boolean language sql stable security definer set search_path=public
as $$ select public.is_full_admin() or exists (
  select 1 from public.administratori a join public.sesiuni_schimb s on s.cont_id = a.id
  where a.id = auth.uid() and a.rol = 'locatie' and s.ended_at is null); $$;
-- true when the given shift is the caller's own, still-open shift
create or replace function public.is_own_open_shift(p_sesiune uuid) returns boolean language sql stable security definer set search_path=public
as $$ select exists (select 1 from public.sesiuni_schimb s where s.id = p_sesiune and s.cont_id = auth.uid() and s.ended_at is null); $$;
create or replace function public.moldova_today() returns date language sql stable set search_path=public
as $$ select (now() at time zone 'Europe/Chisinau')::date $$;

-- ───────────────────────── inventory ─────────────────────────
create or replace function public.deduce_stoc_vestimentatie() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.inventar_id is not null then
    update public.inventar set iesiri = iesiri + new.cantitate, updated_at = now() where id = new.inventar_id;
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv)
      values (new.inventar_id, 'iesire', new.cantitate, 'Eliberare vestimentație #' || new.id);
  end if;
  return new;
end; $$;

create or replace function public.credit_stoc_uzat_vestimentatie() returns trigger language plpgsql security definer set search_path=public as $$
declare v_inv_id text;
begin
  select pereche_uzat_id into v_inv_id from public.inventar where id = new.inventar_id;
  if v_inv_id is null then return new; end if;
  if old.data_returnare is null and new.data_returnare is not null then
    update public.inventar set intrari = intrari + new.cantitate, updated_at = now() where id = v_inv_id;
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv) values (v_inv_id, 'intrare', new.cantitate, 'Returnare vestimentație #' || new.id);
  elsif old.data_returnare is not null and new.data_returnare is null then
    update public.inventar set iesiri = iesiri + old.cantitate, updated_at = now() where id = v_inv_id;
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv) values (v_inv_id, 'iesire', old.cantitate, 'Anulare returnare vestimentație #' || new.id);
  end if;
  return new;
end; $$;

create or replace function public.prevent_vestimentatie_revert() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.data_returnare is not null and new.data_returnare is null and not public.is_full_admin() then
    raise exception 'Doar administratorii pot anula returnarea vestimentației.';
  end if;
  return new;
end; $$;

create or replace function public.prevent_lenjerie_revert() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.data_returnare is not null and new.data_returnare is null and not public.is_full_admin() then
    raise exception 'Doar administratorii pot anula returnarea lenjeriei.';
  end if;
  return new;
end; $$;

create or replace function public.deduce_stoc_lenjerie() returns trigger language plpgsql security definer set search_path=public as $$
declare v_inventar_id text; v_stoc_curent integer;
begin
  v_inventar_id := case when new.sursa_stoc = 'uzat' then 'inv-lenjerie-uzat' else 'inv-lenjerie' end;
  select cantitate_initiala + intrari - iesiri into v_stoc_curent from public.inventar where id = v_inventar_id for update;
  if v_stoc_curent is null then raise exception 'LENJERIE_STOC_LIPSA:%', new.sursa_stoc; end if;
  if v_stoc_curent <= 0 then raise exception 'LENJERIE_STOC_EPUIZAT:%', new.sursa_stoc; end if;
  update public.inventar set iesiri = iesiri + 1, updated_at = now() where id = v_inventar_id;
  insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv) values (v_inventar_id, 'iesire', 1, 'Set lenjerie eliberat #' || new.id);
  return new;
end; $$;

create or replace function public.credit_stoc_uzat_lenjerie() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.data_returnare is null and new.data_returnare is not null then
    update public.inventar set intrari = intrari + 1, updated_at = now() where id = 'inv-lenjerie-uzat';
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv) values ('inv-lenjerie-uzat', 'intrare', 1, 'Returnare set lenjerie #' || new.id);
  elsif old.data_returnare is not null and new.data_returnare is null then
    update public.inventar set iesiri = iesiri + 1, updated_at = now() where id = 'inv-lenjerie-uzat';
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv) values ('inv-lenjerie-uzat', 'iesire', 1, 'Anulare returnare set lenjerie #' || new.id);
  end if;
  return new;
end; $$;

create or replace function public.deduce_stoc_arbitraj() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.cantitate_mingi > 0 then
    update public.inventar set iesiri = iesiri + new.cantitate_mingi, updated_at = now() where id = 'inv-mingi';
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv)
      values ('inv-mingi', 'iesire', new.cantitate_mingi, 'Mingi eliberate arbitrului ' || new.arbitru || ' (' || new.turneu || ')');
  end if;
  return new;
end; $$;

create or replace function public.ajusteaza_stoc_arbitraj_update() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.cantitate_mingi = new.cantitate_mingi then return new; end if;
  if old.cantitate_mingi > 0 then
    update public.inventar set iesiri = greatest(0, iesiri - old.cantitate_mingi), updated_at = now() where id = 'inv-mingi';
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv)
    values ('inv-mingi', 'corectare', old.cantitate_mingi, 'Corecție mingi arbitraj pentru ' || old.arbitru || ' (' || old.turneu || '): anulare valoare anterioară');
  end if;
  if new.cantitate_mingi > 0 then
    update public.inventar set iesiri = iesiri + new.cantitate_mingi, updated_at = now() where id = 'inv-mingi';
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv)
    values ('inv-mingi', 'iesire', new.cantitate_mingi, 'Mingi eliberate arbitrului ' || new.arbitru || ' (' || new.turneu || ')');
  end if;
  return new;
end; $$;

create or replace function public.inventar_log_intrare(p_inventar_id text, p_cantitate integer, p_motiv text default null) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.can_edit_register() then raise exception 'Trebuie să porniți schimbul înainte de a modifica registrul'; end if;
  if p_cantitate is null or p_cantitate <= 0 then raise exception 'Cantitatea trebuie să fie pozitivă'; end if;
  update public.inventar set intrari = intrari + p_cantitate, updated_at = now() where id = p_inventar_id;
  if not found then raise exception 'Articol de inventar inexistent'; end if;
  insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv, administrator_id) values (p_inventar_id, 'intrare', p_cantitate, p_motiv, auth.uid());
end; $$;

create or replace function public.inventar_log_iesire(p_inventar_id text, p_cantitate integer, p_motiv text default null) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_full_admin() then raise exception 'Doar administratorii pot înregistra ieșiri din stoc'; end if;
  if p_cantitate is null or p_cantitate <= 0 then raise exception 'Cantitatea trebuie să fie pozitivă'; end if;
  update public.inventar set iesiri = iesiri + p_cantitate, updated_at = now() where id = p_inventar_id;
  if not found then raise exception 'Articol de inventar inexistent'; end if;
  insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv, administrator_id) values (p_inventar_id, 'iesire', p_cantitate, p_motiv, auth.uid());
end; $$;

create or replace function public.inventar_log_corectie(p_inventar_id text, p_coloana text, p_cantitate integer, p_motiv text default null) returns void language plpgsql security definer set search_path=public as $$
declare v_intrari int; v_iesiri int;
begin
  if not public.is_full_admin() then raise exception 'Doar administratorii pot face corecții de stoc'; end if;
  if p_cantitate is null or p_cantitate <= 0 then raise exception 'Cantitatea trebuie să fie pozitivă'; end if;
  if p_coloana not in ('intrare','iesire') then raise exception 'Coloană invalidă'; end if;
  select intrari, iesiri into v_intrari, v_iesiri from public.inventar where id = p_inventar_id;
  if not found then raise exception 'Articol de inventar inexistent'; end if;
  if p_coloana = 'intrare' then
    if v_intrari - p_cantitate < 0 then raise exception 'Corecția ar face intrările negative'; end if;
    update public.inventar set intrari = intrari - p_cantitate, updated_at = now() where id = p_inventar_id;
  else
    if v_iesiri - p_cantitate < 0 then raise exception 'Corecția ar face ieșirile negative'; end if;
    update public.inventar set iesiri = iesiri - p_cantitate, updated_at = now() where id = p_inventar_id;
  end if;
  insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv, administrator_id)
    values (p_inventar_id, 'corectare', p_cantitate, coalesce(p_motiv, 'Corecție manuală') || ' (coloană: ' || p_coloana || ', -' || p_cantitate || ')', auth.uid());
end; $$;

-- ───────────────────────── tasks / journal / shifts ─────────────────────────
create or replace function public.schimba_status_sarcina(p_sarcina_id uuid, p_status text) returns setof public.sarcini language plpgsql security definer set search_path=public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_service_id uuid; v_actor_name text; v_old_status text; v_descriere text;
begin
  if v_uid is null then raise exception 'Autentificare necesară'; end if;
  if p_status not in ('nesoluționat','în lucru','soluționat') then raise exception 'Statut invalid'; end if;
  if not public.is_full_admin() then
    select s.administrator_serviciu_id into v_service_id from public.sesiuni_schimb s
    where s.cont_id = v_uid and s.ended_at is null order by s.started_at desc limit 1;
    if v_service_id is null then raise exception 'Nu există un schimb activ'; end if;
  end if;
  select s.status, s.descriere into v_old_status, v_descriere from public.sarcini s where s.id = p_sarcina_id for update;
  if not found then raise exception 'Sarcina nu există'; end if;
  if v_old_status = p_status then return query select * from public.sarcini where id = p_sarcina_id; return; end if;
  if v_service_id is not null then
    select sa.nume into v_actor_name from public.serviciu_administratori sa where sa.id = v_service_id;
  else
    select concat_ws(' ', a.nume, a.prenume) into v_actor_name from public.administratori a where a.id = v_uid;
  end if;
  update public.sarcini set status = p_status,
      data_solutionare = case when p_status='soluționat' then public.moldova_today() else null end,
      admin_solutionare_id = case when p_status='soluționat' then v_uid else null end,
      administrator_serviciu_solutionare_id = case when p_status='soluționat' then v_service_id else null end
  where id = p_sarcina_id;
  insert into public.sarcini_istoric_status(sarcina_id, status_vechi, status_nou, cont_id, administrator_serviciu_id)
  values (p_sarcina_id, v_old_status, p_status, v_uid, v_service_id);
  insert into public.jurnal(administrator_id, administrator_serviciu_id, actiune)
  values (v_uid, v_service_id, coalesce(v_actor_name, 'Administrator') || ' a schimbat statutul sarcinii „' || v_descriere || '” din „' || v_old_status || '” în „' || p_status || '”');
  return query select * from public.sarcini where id = p_sarcina_id;
end; $$;

create or replace function public.atribuie_angajat_jurnal_din_schimb() returns trigger language plpgsql set search_path=public, pg_temp as $$
begin
  if new.administrator_serviciu_id is null then
    select s.administrator_serviciu_id into new.administrator_serviciu_id from public.sesiuni_schimb s
    where s.cont_id = new.administrator_id and new.data >= s.started_at and new.data <= coalesce(s.ended_at, now())
    order by s.started_at desc limit 1;
  end if;
  return new;
end; $$;

create or replace function public.inregistreaza_schimb_finalizat_in_serviciu() returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
declare v_data date;
begin
  if old.ended_at is null and new.ended_at is not null then
    v_data := (new.started_at at time zone 'Europe/Chisinau')::date;
    update public.serviciu
    set inceput_la = case when inceput_la is null then new.started_at else least(inceput_la, new.started_at) end,
        sfarsit_la = case when sfarsit_la is null then new.ended_at else greatest(sfarsit_la, new.ended_at) end
    where data = v_data and administrator_serviciu_id = new.administrator_serviciu_id;
    if not found then
      insert into public.serviciu(data, administrator_serviciu_id, inceput_la, sfarsit_la)
      values (v_data, new.administrator_serviciu_id, new.started_at, new.ended_at);
    end if;
  end if;
  return new;
end; $$;

-- ───────────────────────── location PIN ─────────────────────────
create or replace function public.set_locatie_pin(nou_pin text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_full_admin() then raise exception 'Doar administratorii pot modifica PIN-ul locației'; end if;
  if length(nou_pin) < 4 then raise exception 'PIN-ul trebuie să aibă cel puțin 4 caractere'; end if;
  insert into public.locatie_auth (id, pin_hash, updated_at) values (true, extensions.crypt(nou_pin, extensions.gen_salt('bf')), now())
  on conflict (id) do update set pin_hash = excluded.pin_hash, updated_at = now();
end; $$;

create or replace function public.verify_locatie_pin(incercare text) returns boolean language sql security definer set search_path=public as $$
  select pin_hash = extensions.crypt(incercare, pin_hash) from public.locatie_auth where id = true;
$$;

create or replace function public.get_secret(p_name text) returns text language sql security definer set search_path=public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;

-- ───────────────────────── match pay ─────────────────────────
-- Fills suma_net / retinere / suma_bruta on a roster row from the rate valid on the match date.
-- brut = net / (1 - pct/100); reținere = brut - net  (185 net → 217.65 brut, 32.65 reținere).
create or replace function public.calculeaza_plata_meci_jucator() returns trigger language plpgsql security definer set search_path=public as $$
declare v_m record; v_scor_echipa int; v_scor_adv int; v_sit text; v_t record;
begin
  select * into v_m from public.meciuri where id = new.meci_id;
  if new.echipa_id = v_m.echipa_a_id then v_scor_echipa := v_m.scor_a; v_scor_adv := v_m.scor_b;
  elsif new.echipa_id = v_m.echipa_b_id then v_scor_echipa := v_m.scor_b; v_scor_adv := v_m.scor_a;
  else raise exception 'Echipa jucătorului nu participă la acest meci';
  end if;

  if v_scor_echipa is null or v_scor_adv is null then
    new.suma_net := null; new.retinere := null; new.suma_bruta := null;
    return new;
  end if;

  v_sit := case when v_scor_echipa > v_scor_adv then 'victorie' else 'înfrângere' end;
  select net, retinere_pct into v_t from public.tarife_plata
   where rol = new.rol and situatie = v_sit and valabil_de_la <= v_m.data
   order by valabil_de_la desc limit 1;
  if not found then
    new.suma_net := null; new.retinere := null; new.suma_bruta := null;
    return new;
  end if;
  new.suma_net := v_t.net;
  new.suma_bruta := round(v_t.net / (1 - v_t.retinere_pct / 100), 2);
  new.retinere := new.suma_bruta - v_t.net;
  return new;
end; $$;

create or replace function public.recalculeaza_plati_la_schimbare_meci() returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.meci_jucatori set rol = rol where meci_id = new.id;   -- re-fires the BEFORE trigger
  return new;
end; $$;

-- Admin tool: re-apply current rates to every match from p_de_la (e.g. after correcting a rate).
create or replace function public.recalculeaza_plati(p_de_la date) returns integer language plpgsql security definer set search_path=public as $$
declare v_n int;
begin
  if not public.is_full_admin() then raise exception 'Doar administratorii pot recalcula plățile'; end if;
  update public.meci_jucatori mj set rol = mj.rol from public.meciuri m where m.id = mj.meci_id and m.data >= p_de_la;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

-- ───────────────────────── stats ─────────────────────────
create or replace function public.statistici_jucatori(p_de_la date default null, p_pana_la date default null)
returns table(participant_id uuid, meciuri int, victorii int, infrangeri int, win_rate numeric,
              plus_minus numeric, meciuri_capitan int, victorii_capitan int, meciuri_rezerva int,
              total_net numeric, total_retinere numeric, total_brut numeric, echipe text)
language sql stable security invoker set search_path=public as $$
  with r as (
    select mj.participant_id, mj.rol, mj.suma_net, mj.retinere, mj.suma_bruta, e.nume echipa,
           case when mj.echipa_id = m.echipa_a_id then m.scor_a - m.scor_b else m.scor_b - m.scor_a end diff
      from public.meci_jucatori mj
      join public.meciuri m on m.id = mj.meci_id
      join public.echipe e on e.id = mj.echipa_id
     where m.scor_a is not null and m.scor_b is not null
       and (p_de_la is null or m.data >= p_de_la) and (p_pana_la is null or m.data <= p_pana_la)
  )
  select participant_id, count(*)::int, count(*) filter (where diff > 0)::int, count(*) filter (where diff < 0)::int,
         round(count(*) filter (where diff > 0)::numeric / nullif(count(*),0), 4),
         round(avg(diff)::numeric, 1),
         count(*) filter (where rol='căpitan')::int, count(*) filter (where rol='căpitan' and diff > 0)::int,
         count(*) filter (where rol='rezervă')::int,
         coalesce(sum(suma_net),0), coalesce(sum(retinere),0), coalesce(sum(suma_bruta),0),
         string_agg(distinct echipa, ', ')
    from r group by participant_id;
$$;

create or replace function public.statistici_echipe(p_de_la date default null, p_pana_la date default null)
returns table(echipa_id uuid, meciuri int, victorii int, infrangeri int, win_rate numeric,
              puncte_marcate int, puncte_primite int, diferenta_pe_meci numeric)
language sql stable security invoker set search_path=public as $$
  with r as (
    select m.echipa_a_id echipa_id, m.scor_a pf, m.scor_b pa from public.meciuri m
     where m.scor_a is not null and m.scor_b is not null
       and (p_de_la is null or m.data >= p_de_la) and (p_pana_la is null or m.data <= p_pana_la)
    union all
    select m.echipa_b_id, m.scor_b, m.scor_a from public.meciuri m
     where m.scor_a is not null and m.scor_b is not null
       and (p_de_la is null or m.data >= p_de_la) and (p_pana_la is null or m.data <= p_pana_la)
  )
  select echipa_id, count(*)::int, count(*) filter (where pf > pa)::int, count(*) filter (where pf < pa)::int,
         round(count(*) filter (where pf > pa)::numeric / nullif(count(*),0), 4),
         sum(pf)::int, sum(pa)::int, round(avg(pf - pa)::numeric, 1)
    from r group by echipa_id;
$$;

-- ───────────────────────── triggers ─────────────────────────
create trigger trg_vestimentatie_stoc after insert on public.vestimentatie for each row execute function public.deduce_stoc_vestimentatie();
create trigger trg_vestimentatie_uzat_stoc after update of data_returnare on public.vestimentatie for each row execute function public.credit_stoc_uzat_vestimentatie();
create trigger trg_prevent_vestimentatie_revert before update on public.vestimentatie for each row execute function public.prevent_vestimentatie_revert();
create trigger trg_lenjerie_stoc after insert on public.lenjerie for each row execute function public.deduce_stoc_lenjerie();
create trigger trg_lenjerie_uzat_stoc after update of data_returnare on public.lenjerie for each row execute function public.credit_stoc_uzat_lenjerie();
create trigger trg_prevent_lenjerie_revert before update on public.lenjerie for each row execute function public.prevent_lenjerie_revert();
create trigger trg_arbitraj_stoc after insert on public.arbitraj for each row execute function public.deduce_stoc_arbitraj();
create trigger trg_arbitraj_stoc_update after update of cantitate_mingi on public.arbitraj for each row execute function public.ajusteaza_stoc_arbitraj_update();
create trigger trg_atribuie_angajat_jurnal before insert on public.jurnal for each row execute function public.atribuie_angajat_jurnal_din_schimb();
create trigger trg_inregistreaza_schimb_finalizat after update of ended_at on public.sesiuni_schimb for each row
  when (old.ended_at is null and new.ended_at is not null) execute function public.inregistreaza_schimb_finalizat_in_serviciu();
create trigger trg_meci_jucator_plata before insert or update on public.meci_jucatori for each row execute function public.calculeaza_plata_meci_jucator();
create trigger trg_meci_plati after update of scor_a, scor_b, data, echipa_a_id, echipa_b_id on public.meciuri for each row execute function public.recalculeaza_plati_la_schimbare_meci();

-- ───────────────────────── function privileges ─────────────────────────
revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_administrator(), public.is_full_admin(), public.can_edit_register(),
  public.is_own_open_shift(uuid), public.moldova_today(),
  public.inventar_log_intrare(text,int,text), public.inventar_log_iesire(text,int,text), public.inventar_log_corectie(text,text,int,text),
  public.schimba_status_sarcina(uuid,text), public.set_locatie_pin(text), public.recalculeaza_plati(date),
  public.statistici_jucatori(date,date), public.statistici_echipe(date,date)
  to authenticated;
-- PIN check & secrets only via edge functions (service_role): no REST brute force around the rate limit
revoke execute on function public.verify_locatie_pin(text), public.get_secret(text) from authenticated;
grant execute on function public.verify_locatie_pin(text), public.get_secret(text) to service_role;
alter default privileges in schema public revoke execute on functions from public, anon;

-- ───────────────────────── RLS ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['administratori','serviciu_administratori','trusted_ips','locatie_auth','locatie_login_attempts',
    'sesiuni_schimb','serviciu','acte_schimb','echipe','participanti','arbitri','meciuri','meci_jucatori','tarife_plata',
    'intarzieri','inventar','inventar_miscari','vestimentatie','spalatorie','hostel','lenjerie','daune','arbitraj',
    'fair_play','treninguri','observatii','pauze_tehnice','sarcini','sarcini_istoric_status','jurnal','app_config',
    'location_refresh_events']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Standard register tables: read = any account, insert = open shift / admin, update = admin, delete = admin
do $$
declare t text;
begin
  foreach t in array array['intarzieri','daune','fair_play','treninguri','observatii','pauze_tehnice','sarcini']
  loop
    execute format('create policy "%1$s: citire" on public.%1$I for select to authenticated using ((select public.is_administrator()))', t);
    execute format('create policy "%1$s: inserare" on public.%1$I for insert to authenticated with check ((select public.can_edit_register()))', t);
    execute format('create policy "%1$s: actualizare admin" on public.%1$I for update to authenticated using ((select public.is_full_admin())) with check ((select public.is_full_admin()))', t);
    execute format('create policy "%1$s: stergere admin" on public.%1$I for delete to authenticated using ((select public.is_full_admin()))', t);
  end loop;
  -- tables the on-site account may also update during an open shift
  foreach t in array array['participanti','arbitri','hostel','lenjerie','spalatorie','vestimentatie','echipe']
  loop
    execute format('create policy "%1$s: citire" on public.%1$I for select to authenticated using ((select public.is_administrator()))', t);
    execute format('create policy "%1$s: inserare" on public.%1$I for insert to authenticated with check ((select public.can_edit_register()))', t);
    execute format('create policy "%1$s: actualizare" on public.%1$I for update to authenticated using ((select public.can_edit_register())) with check ((select public.can_edit_register()))', t);
    execute format('create policy "%1$s: stergere admin" on public.%1$I for delete to authenticated using ((select public.is_full_admin()))', t);
  end loop;
  -- admin-managed tables
  foreach t in array array['inventar','inventar_miscari','serviciu','serviciu_administratori','tarife_plata']
  loop
    execute format('create policy "%1$s: citire" on public.%1$I for select to authenticated using ((select public.is_administrator()))', t);
    execute format('create policy "%1$s: inserare admin" on public.%1$I for insert to authenticated with check ((select public.is_full_admin()))', t);
    execute format('create policy "%1$s: actualizare admin" on public.%1$I for update to authenticated using ((select public.is_full_admin())) with check ((select public.is_full_admin()))', t);
    execute format('create policy "%1$s: stergere admin" on public.%1$I for delete to authenticated using ((select public.is_full_admin()))', t);
  end loop;
  foreach t in array array['trusted_ips','locatie_auth','locatie_login_attempts']
  loop
    execute format('create policy "%1$s: doar admin" on public.%1$I for all to authenticated using ((select public.is_full_admin())) with check ((select public.is_full_admin()))', t);
  end loop;
end $$;

create policy "administratori: citire" on public.administratori for select to authenticated using ((select public.is_administrator()));
create policy "administratori: actualizare propriul profil" on public.administratori for update to authenticated
  using (id = (select auth.uid()) and (select public.is_full_admin())) with check (id = (select auth.uid()) and rol = 'admin');

create policy "jurnal: citire admin" on public.jurnal for select to authenticated using ((select public.is_full_admin()));
create policy "jurnal: inserare" on public.jurnal for insert to authenticated with check ((select public.is_administrator()) and administrator_id = (select auth.uid()));
create policy "jurnal: stergere admin" on public.jurnal for delete to authenticated using ((select public.is_full_admin()));

create policy "sarcini istoric: citire" on public.sarcini_istoric_status for select to authenticated using ((select public.is_administrator()));

create policy "sesiuni: citire" on public.sesiuni_schimb for select to authenticated using ((select public.is_full_admin()) or cont_id = (select auth.uid()));
create policy "sesiuni: pornire locatie" on public.sesiuni_schimb for insert to authenticated
  with check (cont_id = (select auth.uid()) and ended_at is null and exists (select 1 from public.administratori a where a.id = (select auth.uid()) and a.rol = 'locatie'));
create policy "sesiuni: incheiere proprie" on public.sesiuni_schimb for update to authenticated
  using (cont_id = (select auth.uid()) and ended_at is null) with check (cont_id = (select auth.uid()) and ended_at is not null);
create policy "sesiuni: stergere admin" on public.sesiuni_schimb for delete to authenticated using ((select public.is_full_admin()));

create policy "acte: citire" on public.acte_schimb for select to authenticated using ((select public.is_administrator()));
create policy "acte: inserare" on public.acte_schimb for insert to authenticated with check ((select public.can_edit_register()));
create policy "acte: actualizare" on public.acte_schimb for update to authenticated
  using ((select public.is_full_admin()) or (select public.is_own_open_shift(sesiune_schimb_id)))
  with check ((select public.is_full_admin()) or (select public.is_own_open_shift(sesiune_schimb_id)));
create policy "acte: stergere admin" on public.acte_schimb for delete to authenticated using ((select public.is_full_admin()));

-- arbitraj & matches: on-site account may correct only rows of its own open shift
create policy "arbitraj: citire" on public.arbitraj for select to authenticated using ((select public.is_administrator()));
create policy "arbitraj: inserare" on public.arbitraj for insert to authenticated with check ((select public.can_edit_register()));
create policy "arbitraj: actualizare" on public.arbitraj for update to authenticated
  using ((select public.is_full_admin()) or (select public.is_own_open_shift(sesiune_schimb_id)))
  with check ((select public.is_full_admin()) or (select public.is_own_open_shift(sesiune_schimb_id)));
create policy "arbitraj: stergere admin" on public.arbitraj for delete to authenticated using ((select public.is_full_admin()));

create policy "meciuri: citire" on public.meciuri for select to authenticated using ((select public.is_administrator()));
create policy "meciuri: inserare" on public.meciuri for insert to authenticated
  with check ((select public.is_full_admin()) or ((select public.can_edit_register()) and (select public.is_own_open_shift(sesiune_schimb_id))));
create policy "meciuri: actualizare" on public.meciuri for update to authenticated
  using ((select public.is_full_admin()) or (select public.is_own_open_shift(sesiune_schimb_id)))
  with check ((select public.is_full_admin()) or (select public.is_own_open_shift(sesiune_schimb_id)));
create policy "meciuri: stergere" on public.meciuri for delete to authenticated
  using ((select public.is_full_admin()) or (select public.is_own_open_shift(sesiune_schimb_id)));

create policy "meci_jucatori: citire" on public.meci_jucatori for select to authenticated using ((select public.is_administrator()));
create policy "meci_jucatori: inserare" on public.meci_jucatori for insert to authenticated
  with check ((select public.is_full_admin()) or exists (select 1 from public.meciuri m where m.id = meci_id and public.is_own_open_shift(m.sesiune_schimb_id)));
create policy "meci_jucatori: actualizare" on public.meci_jucatori for update to authenticated
  using ((select public.is_full_admin()) or exists (select 1 from public.meciuri m where m.id = meci_id and public.is_own_open_shift(m.sesiune_schimb_id)))
  with check ((select public.is_full_admin()) or exists (select 1 from public.meciuri m where m.id = meci_id and public.is_own_open_shift(m.sesiune_schimb_id)));
create policy "meci_jucatori: stergere" on public.meci_jucatori for delete to authenticated
  using ((select public.is_full_admin()) or exists (select 1 from public.meciuri m where m.id = meci_id and public.is_own_open_shift(m.sesiune_schimb_id)));

create policy "app_config: citire" on public.app_config for select to authenticated using (true);
create policy "app_config: scriere admin" on public.app_config for all to authenticated using ((select public.is_full_admin())) with check ((select public.is_full_admin()));
create policy "refresh: citire" on public.location_refresh_events for select to authenticated using (true);
create policy "refresh: scriere admin" on public.location_refresh_events for all to authenticated using ((select public.is_full_admin())) with check ((select public.is_full_admin()));

-- ───────────────────────── storage: player photos (private) ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotografii', 'fotografii', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "fotografii: citire" on storage.objects for select to authenticated using (bucket_id = 'fotografii' and (select public.is_administrator()));
create policy "fotografii: incarcare" on storage.objects for insert to authenticated with check (bucket_id = 'fotografii' and (select public.can_edit_register()));
create policy "fotografii: inlocuire" on storage.objects for update to authenticated using (bucket_id = 'fotografii' and (select public.can_edit_register())) with check (bucket_id = 'fotografii' and (select public.can_edit_register()));
create policy "fotografii: stergere" on storage.objects for delete to authenticated using (bucket_id = 'fotografii' and (select public.is_full_admin()));
