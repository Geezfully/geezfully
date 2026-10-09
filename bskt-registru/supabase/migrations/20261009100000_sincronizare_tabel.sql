-- Sync with the owners' Google Sheet ("_BSKT CUP 3х3 Schedule&Result Chisinau").
-- Sheet = source of truth for results, line-ups, ratings and teams; 3x3.bsktcup.com = fallback for results.
-- Manual changes in the app always win: every sync remembers what it last wrote (sync_baza / *_sync) and only
-- touches a value that still equals that baseline. A match deleted by hand is remembered and never re-created.
-- A locked week (saptamani_blocate) cannot be changed by anyone or any sync until an admin unlocks it.

-- ───────── matches ─────────
alter table public.meciuri drop constraint if exists meciuri_sursa_check;
alter table public.meciuri add constraint meciuri_sursa_check check (sursa in ('manual','bsktcup','tabel'));
alter table public.meciuri
  add column if not exists sync_baza jsonb,              -- {data,ora,a,b,sa,sb,ot,lot:{<echipa_id>:["<participant>:<rol>",…]}} as last written by a sync
  add column if not exists tabel_actualizat_la timestamptz;

-- ───────── players: baselines for values the sheet manages ─────────
alter table public.participanti
  add column if not exists rating_sync int,
  add column if not exists echipa_sync uuid,
  add column if not exists creat_din_tabel boolean not null default false;

-- ───────── how each name written in the sheet maps to a registry player ─────────
create table if not exists public.tabel_jucatori (
  cheie text primary key,                       -- normalised name (lower case, no diacritics, sorted words)
  nume text not null,                           -- as written in the sheet
  participant_id uuid references public.participanti(id) on delete set null,
  status text not null check (status in ('auto','confirmat','nou','in_asteptare')),
  propunere_id uuid references public.participanti(id) on delete set null,
  scor numeric,
  echipa text, rating int,
  aparitii int not null default 0, prima_data date, ultima_data date,
  rezolvat_de uuid references public.administratori(id) on delete set null,
  rezolvat_la timestamptz,
  creat_la timestamptz not null default now()
);
alter table public.tabel_jucatori enable row level security;
create policy "tabel_jucatori: citire admin" on public.tabel_jucatori for select to authenticated using ((select public.is_full_admin()));

-- ───────── connection to the sheet (Apps Script web app) — admins only, never the venue/helper accounts ─────────
create table if not exists public.tabel_config (
  id boolean primary key default true check (id),
  url text, cheie text, activ boolean not null default false,
  actualizat_la timestamptz not null default now()
);
insert into public.tabel_config (id) values (true) on conflict do nothing;
alter table public.tabel_config enable row level security;
create policy "tabel_config: citire admin" on public.tabel_config for select to authenticated using ((select public.is_full_admin()));

alter table public.sync_rezultate add column if not exists sursa text not null default 'site' check (sursa in ('site','tabel'));

-- ───────── matches deleted by hand are never re-created by a sync ─────────
create table if not exists public.meciuri_sterse (
  cheie text primary key,                       -- 'nr:<match no.>' or 'site:<id_extern>'
  sters_de uuid, sters_la timestamptz not null default now()
);
alter table public.meciuri_sterse enable row level security;
create policy "meciuri_sterse: citire admin" on public.meciuri_sterse for select to authenticated using ((select public.is_full_admin()));

create or replace function public.memoreaza_meci_sters() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then return old; end if;   -- deletions made by a sync are not "manual"
  if old.nr is not null then
    insert into public.meciuri_sterse (cheie, sters_de) values ('nr:' || old.nr, auth.uid()) on conflict (cheie) do nothing;
  end if;
  if old.id_extern is not null then
    insert into public.meciuri_sterse (cheie, sters_de) values ('site:' || old.id_extern, auth.uid()) on conflict (cheie) do nothing;
  end if;
  return old;
end; $$;
drop trigger if exists trg_memoreaza_meci_sters on public.meciuri;
create trigger trg_memoreaza_meci_sters after delete on public.meciuri for each row execute function public.memoreaza_meci_sters();

-- ───────── locked weeks ─────────
create table if not exists public.saptamani_blocate (
  luni date primary key check (extract(isodow from luni) = 1),
  blocat_de uuid references public.administratori(id) on delete set null,
  blocat_la timestamptz not null default now()
);
alter table public.saptamani_blocate enable row level security;
create policy "saptamani_blocate: citire" on public.saptamani_blocate for select to authenticated using ((select public.is_administrator()));

create or replace function public.saptamana_blocata(p_data date) returns boolean language sql stable security definer set search_path=public as $$
  select p_data is not null and exists (select 1 from public.saptamani_blocate where luni = date_trunc('week', p_data)::date);
$$;

create or replace function public.verifica_saptamana_blocata() returns trigger language plpgsql security definer set search_path=public as $$
declare v_zile date[] := '{}';
begin
  if tg_table_name = 'meciuri' then
    if tg_op in ('UPDATE','DELETE') then v_zile := v_zile || old.data; end if;
    if tg_op in ('INSERT','UPDATE') then v_zile := v_zile || new.data; end if;
  else
    if tg_op in ('UPDATE','DELETE') then v_zile := v_zile || (select m.data from public.meciuri m where m.id = old.meci_id); end if;
    if tg_op in ('INSERT','UPDATE') then v_zile := v_zile || (select m.data from public.meciuri m where m.id = new.meci_id); end if;
  end if;
  if exists (select 1 from unnest(v_zile) z where public.saptamana_blocata(z)) then
    raise exception 'SAPTAMANA_BLOCATA: săptămâna este blocată — deblocați-o din Plăți înainte de a o modifica' using errcode = '42501';
  end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists trg_saptamana_blocata on public.meciuri;
create trigger trg_saptamana_blocata before insert or update or delete on public.meciuri for each row execute function public.verifica_saptamana_blocata();
drop trigger if exists trg_saptamana_blocata on public.meci_jucatori;
create trigger trg_saptamana_blocata before insert or update or delete on public.meci_jucatori for each row execute function public.verifica_saptamana_blocata();

create or replace function public.blocheaza_saptamana(p_luni date, p_blocat boolean) returns void
language plpgsql security definer set search_path=public as $$
declare v_luni date := date_trunc('week', p_luni)::date;
begin
  if not public.is_full_admin() then raise exception 'Doar administratorii pot bloca sau debloca săptămâni'; end if;
  if p_blocat then
    insert into public.saptamani_blocate (luni, blocat_de) values (v_luni, auth.uid()) on conflict (luni) do nothing;
  else
    delete from public.saptamani_blocate where luni = v_luni;
  end if;
  insert into public.jurnal (administrator_id, actiune)
  values (auth.uid(), case when p_blocat then 'A blocat' else 'A deblocat' end || ' săptămâna ' || to_char(v_luni, 'DD.MM') || '–' || to_char(v_luni + 6, 'DD.MM.YYYY'));
end; $$;

-- the pay-recalculation tool skips locked weeks instead of failing on them
create or replace function public.recalculeaza_plati(p_de_la date) returns integer language plpgsql security definer set search_path=public as $$
declare v_n int;
begin
  if not public.is_full_admin() then raise exception 'Doar administratorii pot recalcula plățile'; end if;
  update public.meci_jucatori mj set rol = mj.rol from public.meciuri m
   where m.id = mj.meci_id and m.data >= p_de_la and not public.saptamana_blocata(m.data);
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

-- ───────── admin actions on sheet names ─────────
-- link a sheet name to an existing player, or create a new player for it (name split as the admin typed it)
create or replace function public.rezolva_jucator_tabel(p_cheie text, p_participant_id uuid, p_nume text default null, p_prenume text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_row public.tabel_jucatori; v_pid uuid; v_echipa uuid;
begin
  if not public.is_full_admin() then raise exception 'Doar administratorii pot confirma jucătorii din tabel'; end if;
  select * into v_row from public.tabel_jucatori where cheie = p_cheie for update;
  if not found then raise exception 'Numele nu mai există în lista tabelului'; end if;
  if p_participant_id is not null then
    v_pid := p_participant_id;
    update public.tabel_jucatori set participant_id = v_pid, status = 'confirmat', rezolvat_de = auth.uid(), rezolvat_la = now() where cheie = p_cheie;
    insert into public.jurnal (administrator_id, actiune)
    select auth.uid(), 'A legat numele din tabel „' || v_row.nume || '” de jucătorul ' || p.nume || ' ' || p.prenume from public.participanti p where p.id = v_pid;
  else
    if coalesce(trim(p_nume), '') = '' or coalesce(trim(p_prenume), '') = '' then raise exception 'Completați numele și prenumele jucătorului nou'; end if;
    select id into v_echipa from public.echipe where lower(nume) = lower(v_row.echipa) limit 1;
    insert into public.participanti (nume, prenume, echipa_id, echipa_sync, rating, rating_sync, rol_echipa, statut, creat_din_tabel)
    values (trim(p_nume), trim(p_prenume), v_echipa, v_echipa, v_row.rating, v_row.rating, 'jucător', 'activ', true)
    returning id into v_pid;
    update public.tabel_jucatori set participant_id = v_pid, status = 'nou', rezolvat_de = auth.uid(), rezolvat_la = now() where cheie = p_cheie;
    insert into public.jurnal (administrator_id, actiune)
    values (auth.uid(), 'A creat jucătorul ' || trim(p_nume) || ' ' || trim(p_prenume) || ' din tabel (numele „' || v_row.nume || '”)');
  end if;
  return v_pid;
end; $$;

-- "use the sheet's values again" for a match that was changed by hand
create or replace function public.accepta_tabel_pentru_meci(p_meci uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not public.is_full_admin() then raise exception 'Doar administratorii pot face asta'; end if;
  update public.meciuri set sync_baza = null where id = p_meci;
  insert into public.jurnal (administrator_id, actiune) values (auth.uid(), 'A cerut ca un meci modificat manual să preia din nou datele din tabel');
end; $$;

-- connection settings: the web-app URL of the sheet script and the shared key it checks
create or replace function public.seteaza_tabel_config(p_url text, p_cheie_noua boolean default false)
returns text language plpgsql security definer set search_path=public, extensions as $$
declare v_cheie text;
begin
  if not public.is_full_admin() then raise exception 'Doar administratorii pot configura sincronizarea'; end if;
  if p_url is not null and p_url !~ '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$' then
    raise exception 'Adresa trebuie să fie linkul aplicației web Apps Script (https://script.google.com/macros/s/…/exec)';
  end if;
  if p_cheie_noua then v_cheie := encode(extensions.gen_random_bytes(24), 'hex'); end if;
  update public.tabel_config set url = coalesce(p_url, url), cheie = coalesce(v_cheie, cheie),
         activ = coalesce(p_url, url) is not null and coalesce(v_cheie, cheie) is not null, actualizat_la = now()
   where id = true;   -- Supabase refuses an UPDATE without WHERE, even on this one-row table
  insert into public.jurnal (administrator_id, actiune) values (auth.uid(), 'A actualizat legătura cu tabelul Google');
  return (select cheie from public.tabel_config where id = true);
end; $$;

revoke execute on function public.memoreaza_meci_sters(), public.verifica_saptamana_blocata() from public, anon, authenticated;
revoke execute on function public.saptamana_blocata(date), public.blocheaza_saptamana(date, boolean), public.rezolva_jucator_tabel(text, uuid, text, text),
  public.accepta_tabel_pentru_meci(uuid), public.seteaza_tabel_config(text, boolean) from public, anon;
grant execute on function public.saptamana_blocata(date), public.blocheaza_saptamana(date, boolean), public.rezolva_jucator_tabel(text, uuid, text, text),
  public.accepta_tabel_pentru_meci(uuid), public.seteaza_tabel_config(text, boolean) to authenticated;
