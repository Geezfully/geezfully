-- ATTP Pontaj (Registru Electronic Locație) — consolidated schema snapshot
-- Captured 2026-10-06 from Supabase project ildoegipvcgxboijfksw ("ATTP Pontaj").
-- Reference / baseline for cloning the registru (e.g. the basketball registru).
-- Sections marked [SETKA] are table-tennis-only (Setka Cup rating + pay deductions)
-- and should NOT be carried into a non-ATTP clone.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- ───────────────────────── accounts / roles ─────────────────────────
-- administratori.id = auth.users.id. rol 'admin' = full admin (owner/managers),
-- rol 'locatie' = the shared on-site tablet account (email locatie@attp-pontaj.internal),
-- which logs in via PIN + trusted IP through the location-login edge function.
create table public.administratori (
  id uuid primary key references auth.users(id),
  nume text not null, prenume text not null,
  created_at timestamptz not null default now(),
  ascuns boolean not null default false,              -- hide owner account in UI
  rol text not null default 'admin' check (rol in ('admin','locatie'))
);

-- People who actually work the shift (names picked when the location account starts a shift)
create table public.serviciu_administratori (
  id uuid primary key default gen_random_uuid(),
  nume text not null unique,
  activ boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.trusted_ips (
  id uuid primary key default gen_random_uuid(),
  ip text not null unique, eticheta text,
  adaugat_de uuid references public.administratori(id),
  created_at timestamptz not null default now()
);
create table public.locatie_auth (            -- singleton row, bcrypt PIN
  id boolean primary key default true check (id),
  pin_hash text not null, updated_at timestamptz not null default now()
);
create table public.locatie_login_attempts (  -- 5 fails -> 15 min block per IP
  ip text primary key, esuate int not null default 0,
  blocat_pana timestamptz, updated_at timestamptz not null default now()
);

-- ───────────────────────── shifts ─────────────────────────
create table public.sesiuni_schimb (
  id uuid primary key default gen_random_uuid(),
  cont_id uuid not null references public.administratori(id),
  administrator_serviciu_id uuid not null references public.serviciu_administratori(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index sesiuni_schimb_unul_deschis_per_cont on public.sesiuni_schimb(cont_id) where ended_at is null;

create table public.serviciu (                -- duty calendar; auto-filled when a shift ends
  id uuid primary key default gen_random_uuid(),
  data date not null,
  administrator_id uuid references public.administratori(id),
  administrator_serviciu_id uuid references public.serviciu_administratori(id),
  inceput_la timestamptz, sfarsit_la timestamptz,
  created_at timestamptz not null default now()
);
create unique index serviciu_data_administrator_serviciu_uidx on public.serviciu(data, administrator_serviciu_id) where administrator_serviciu_id is not null;

create table public.acte_schimb (             -- shift handover report (JSON content, rendered/PDF in UI)
  id uuid primary key default gen_random_uuid(),
  sesiune_schimb_id uuid references public.sesiuni_schimb(id),
  administrator_serviciu_id uuid references public.serviciu_administratori(id),
  administrator_id uuid references public.administratori(id),
  data date not null default current_date,
  inceput_perioada timestamptz not null,
  sfarsit_perioada timestamptz not null default now(),
  nume_administrator text not null,
  continut jsonb not null,
  created_at timestamptz not null default now()
);

-- ───────────────────────── people ─────────────────────────
create table public.participanti (            -- players
  id uuid primary key default gen_random_uuid(),
  nr_dulap text, nume text not null, prenume text not null,
  data_nasterii date, adresa text, telefon text, email text,
  data_aviz_medical date,                     -- medical certificate, valid 6 months (UI)
  marime text check (marime in ('M','L','XL','XXL','XXXL')),
  statut text not null default 'activ' check (statut in ('activ','inactiv')),
  data_inregistrarii date not null default current_date,
  created_at timestamptz not null default now(),
  categorie_sportiva text check (categorie_sportiva is null or categorie_sportiva in ('MS','CMS','Categoria I','Categoria II','Categoria III','Amator')),
  eligibil_antrenament boolean not null default false,
  setka_id int, setka_legat_manual boolean not null default false   -- [SETKA]
);
create table public.arbitri (                 -- referees (same shape as participanti)
  id uuid primary key default gen_random_uuid(),
  nr_dulap text, nume text not null, prenume text not null,
  data_nasterii date, adresa text, telefon text, email text, data_aviz_medical date,
  statut text not null default 'activ' check (statut in ('activ','inactiv')),
  data_inregistrarii date not null default current_date,
  created_at timestamptz not null default now()
);

-- ───────────────────────── registers ─────────────────────────
create table public.intarzieri (participant_id uuid references public.participanti(id), arbitru text,   -- lateness (player OR referee name)
  id uuid primary key default gen_random_uuid(), data date not null default current_date,
  minute_intarziere int, motiv text, created_at timestamptz not null default now());

create table public.vestimentatie (participant_id uuid references public.participanti(id), arbitru text, -- jerseys issued
  id uuid primary key default gen_random_uuid(), data date not null default current_date,
  tip text not null, culoare text, marime text, cantitate int not null default 1 check (cantitate > 0),
  data_returnare date, stare_returnare text, created_at timestamptz not null default now());

create table public.spalatorie (id uuid primary key default gen_random_uuid(),                          -- laundry (charged)
  participant_id uuid references public.participanti(id), data date not null default current_date,
  tip_articole text, suma numeric not null default 0, cantitate int not null default 1,
  data_returnare date, created_at timestamptz not null default now());

create table public.hostel (id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participanti(id), data_cazare date not null default current_date,
  observatii text, statut text not null default 'închis' check (statut in ('activ','închis')),
  created_at timestamptz not null default now());

create table public.lenjerie (id uuid primary key default gen_random_uuid(),                            -- bed linen sets
  participant_id uuid not null references public.participanti(id), data_eliberare date not null default current_date,
  data_returnare date, sursa_stoc text not null default 'nou' check (sursa_stoc in ('nou','uzat')),
  created_at timestamptz not null default now());

create table public.daune (id uuid primary key default gen_random_uuid(),                               -- damage fund
  data date not null default current_date, participant_id uuid not null references public.participanti(id),
  inventar_afectat text, natura text, stare text check (stare in ('afectat','deteriorat','distrus')),
  observatii text, valoare_estimata numeric not null default 0,
  administrator_serviciu_avertizor_id uuid references public.serviciu_administratori(id),
  admin_avertizor_id uuid references public.administratori(id),
  nume_avertizor_original text, sursa_import text, nr_sursa int,
  teren text check (teren is null or teren in ('Mexico','Rio')),       -- ATTP venues
  created_at timestamptz not null default now());

create table public.arbitraj (id uuid primary key default gen_random_uuid(),                            -- referee per shift slot + balls issued
  data date not null default current_date, arbitru text not null,
  turneu text not null check (turneu in ('RIO','MEXICO Day','MEXICO Night')),
  cantitate_mingi int not null default 0 check (cantitate_mingi >= 0),
  marca_mingi text not null default 'DHS' check (marca_mingi in ('DHS','JOOLA')),
  observatii text, sesiune_schimb_id uuid references public.sesiuni_schimb(id),
  slot_schimb smallint check (slot_schimb between 1 and 3),
  created_at timestamptz not null default now());
create unique index arbitraj_sesiune_slot_uidx on public.arbitraj(sesiune_schimb_id, slot_schimb) where sesiune_schimb_id is not null and slot_schimb is not null;

create table public.fair_play (id uuid primary key default gen_random_uuid(),                           -- yellow/red cards
  participant_id uuid not null references public.participanti(id), data date not null default current_date, ora time,
  platou text not null check (platou in ('RIO','MEXICO Day','MEXICO Night')),
  descriere text, tip_cartonas text not null check (tip_cartonas in ('galben','roșu')),
  created_at timestamptz not null default now());

create table public.treninguri (id uuid primary key default gen_random_uuid(),                          -- paid trainings
  participant_id uuid not null references public.participanti(id), antrenor text not null,
  data date not null, ora time, suma_jucator numeric not null default 100, suma_antrenor numeric not null default 200,
  observatii text, created_at timestamptz not null default now());

create table public.observatii (id uuid primary key default gen_random_uuid(),
  data date not null default current_date, participant_id uuid references public.participanti(id),
  categorie text not null, subiect text, descriere text, created_at timestamptz not null default now());

create table public.pauze_tehnice (id uuid primary key default gen_random_uuid(),
  data date not null default current_date, ora_start time not null, ora_stop time not null,
  teren text not null, descriere text not null, created_at timestamptz not null default now());

create table public.sarcini (id uuid primary key default gen_random_uuid(),                             -- tasks
  data_inreg date not null default current_date, admin_inreg_id uuid references public.administratori(id),
  descriere text not null,
  status text not null default 'nesoluționat' check (status in ('nesoluționat','în lucru','soluționat')),
  actiuni text, data_solutionare date, admin_solutionare_id uuid references public.administratori(id),
  administrator_serviciu_inreg_id uuid references public.serviciu_administratori(id),
  administrator_serviciu_solutionare_id uuid references public.serviciu_administratori(id),
  created_at timestamptz not null default now());
create table public.sarcini_istoric_status (id uuid primary key default gen_random_uuid(),
  sarcina_id uuid not null references public.sarcini(id),
  status_vechi text not null, status_nou text not null,
  cont_id uuid not null references public.administratori(id),
  administrator_serviciu_id uuid references public.serviciu_administratori(id),
  schimbat_la timestamptz not null default now());

create table public.jurnal (id uuid primary key default gen_random_uuid(),                              -- activity log
  administrator_id uuid references public.administratori(id), actiune text not null,
  data timestamptz not null default now(),
  administrator_serviciu_id uuid references public.serviciu_administratori(id));

-- ───────────────────────── inventory ─────────────────────────
-- Text ids encode the item: inv-r-<size> red jersey, inv-a-<size> blue jersey,
-- inv-sort-<size> shorts, inv-lenjerie, inv-mingi (DHS), inv-mingi-joola; each has a "-uzat" twin
-- (used stock) that returned items flow into.
create table public.inventar (
  id text primary key, denumire text not null, culoare text, marime text,
  um text not null default 'buc', cantitate_initiala int not null default 0,
  intrari int not null default 0, iesiri int not null default 0,
  cantitate_curenta int generated always as (cantitate_initiala + intrari - iesiri) stored,
  cantitate_minima int not null default 0, stare text not null default 'bună', observatii text,
  updated_at timestamptz not null default now(),
  conditie text not null default 'nou' check (conditie in ('nou','uzat')));
create table public.inventar_miscari (id uuid primary key default gen_random_uuid(),
  inventar_id text not null references public.inventar(id),
  tip text not null check (tip in ('intrare','iesire','corectare')),
  cantitate int not null, motiv text, administrator_id uuid references public.administratori(id),
  created_at timestamptz not null default now());

-- ───────────────────────── app plumbing ─────────────────────────
create table public.app_config (key text primary key, value text not null, updated_at timestamptz not null default now());
-- key 'location_app_build': the frontend compares its build id and forces a reload when stale.
create table public.location_refresh_events (id uuid primary key default gen_random_uuid(),
  scheduled_at timestamptz not null, expires_at timestamptz not null,
  requires_active_shift boolean not null default true, created_at timestamptz not null default now());

-- [SETKA] setka_jucatori, setka_rating_istoric, setka_sync_log + setka_rating_rezumat(),
-- setka_deduceri(), setka_ping_after_change(), setka_sync_watchdog(), edge fn setka-rating-sync. Not cloned.

-- ───────────────────────── permission helpers ─────────────────────────
create function public.is_administrator() returns boolean language sql stable security definer set search_path=public
as $$ select exists (select 1 from public.administratori where id = auth.uid()); $$;
create function public.is_full_admin() returns boolean language sql stable security definer set search_path=public
as $$ select exists (select 1 from public.administratori where id = auth.uid() and rol = 'admin'); $$;
-- Location account may write only while it has an open shift.
create function public.can_edit_register() returns boolean language sql stable security definer set search_path=public
as $$ select public.is_full_admin() or exists (
  select 1 from public.administratori a join public.sesiuni_schimb s on s.cont_id = a.id
  where a.id = auth.uid() and a.rol = 'locatie' and s.ended_at is null); $$;
create function public.moldova_today() returns date language sql stable
as $$ select (now() at time zone 'Europe/Chisinau')::date $$;

-- RLS pattern (every table has RLS on):
--   SELECT  : is_administrator()           (jurnal: is_full_admin())
--   INSERT  : can_edit_register()          (inventar/inventar_miscari/serviciu/serviciu_administratori: is_full_admin(); jurnal, arbitri: is_administrator())
--   UPDATE  : is_full_admin()  EXCEPT participanti, arbitri, hostel, lenjerie, spalatorie, vestimentatie -> can_edit_register();
--             arbitraj -> full admin OR own open shift's rows; acte_schimb -> full admin OR own shift
--   DELETE  : is_full_admin()
--   trusted_ips, locatie_auth, locatie_login_attempts: ALL is_full_admin()
--   sesiuni_schimb: select full admin or own; insert own if rol='locatie'; update own open -> ended; delete full admin
--   app_config, location_refresh_events: select authenticated

-- ───────────────────────── business-logic functions (abridged; see live defs) ─────────────────────────
-- deduce_stoc_vestimentatie  AFTER INSERT vestimentatie: tip ~ roșu -> inv-r-<size>, albastru -> inv-a-<size>; iesiri += cantitate + log
-- credit_stoc_uzat_vestimentatie AFTER UPDATE data_returnare: returned -> <id>-uzat intrari += qty (and reverse on un-return)
-- prevent_vestimentatie_revert / prevent_lenjerie_revert BEFORE UPDATE: only full admin can clear data_returnare
-- deduce_stoc_lenjerie AFTER INSERT lenjerie: picks inv-lenjerie or inv-lenjerie-uzat by sursa_stoc, raises LENJERIE_STOC_EPUIZAT if 0
-- credit_stoc_uzat_lenjerie AFTER UPDATE data_returnare -> inv-lenjerie-uzat
-- deduce_stoc_arbitraj AFTER INSERT / ajusteaza_stoc_arbitraj_update AFTER UPDATE: balls DHS->inv-mingi, JOOLA->inv-mingi-joola
-- inventar_log_intrare(id,qty,motiv) [can_edit_register], inventar_log_iesire / inventar_log_corectie [full admin]
-- schimba_status_sarcina(id,status): validates open shift for location acct, writes sarcini_istoric_status + jurnal
-- atribuie_angajat_jurnal_din_schimb BEFORE INSERT jurnal: fills administrator_serviciu_id from shift active at that time
-- inregistreaza_schimb_finalizat_in_serviciu AFTER UPDATE ended_at: upserts serviciu row (Chisinau date, min start / max end)
-- set_locatie_pin(pin) [full admin], verify_locatie_pin(pin) (bcrypt via extensions.crypt)
-- get_resend_api_key() reads vault secret 'resend_api_key' (service_role only)

-- ───────────────────────── edge functions & cron ─────────────────────────
-- location-login (verify_jwt=false): POST {pin}; checks locatie_login_attempts block, trusted_ips, verify_locatie_pin,
--   then admin.generateLink(magiclink, LOCATION_EMAIL) + verifyOtp -> returns access/refresh token.
-- daily-backup (x-cron-secret header): dumps all tables to JSON, emails via Resend to the owner.
-- cron 'attp-daily-backup' 0 20 * * * -> net.http_post to daily-backup.
-- vault secrets: resend_api_key.

-- KNOWN ISSUE to fix in clones: verify_locatie_pin / set_locatie_pin / inventar_log_* / is_full_admin are
-- EXECUTE-able by anon. verify_locatie_pin via REST bypasses the edge function's rate limit & IP check
-- -> revoke execute from anon, authenticated on verify_locatie_pin.

-- ═════════════════════════ FULL FUNCTION BODIES (verbatim from live) ═════════════════════════
create or replace function public.deduce_stoc_vestimentatie() returns trigger language plpgsql security definer set search_path=public as $$
declare v_inv_id text;
begin
  v_inv_id := case
    when new.tip ilike '%roșu%' or new.tip ilike '%rosu%' then 'inv-r-' || lower(new.marime)
    when new.tip ilike '%albastru%' then 'inv-a-' || lower(new.marime)
    else null end;
  if v_inv_id is not null then
    update public.inventar set iesiri = iesiri + new.cantitate, updated_at = now() where id = v_inv_id;
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv)
      values (v_inv_id, 'iesire', new.cantitate, 'Eliberare vestimentație #' || new.id);
  end if;
  return new;
end; $$;

create or replace function public.credit_stoc_uzat_vestimentatie() returns trigger language plpgsql security definer set search_path=public as $$
declare v_inv_id text;
begin
  v_inv_id := case
    when new.tip ilike '%roșu%' or new.tip ilike '%rosu%' then 'inv-r-' || lower(new.marime) || '-uzat'
    when new.tip ilike '%albastru%' then 'inv-a-' || lower(new.marime) || '-uzat'
    else null end;
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
  if old.data_returnare is not null and new.data_returnare is null and not is_full_admin() then
    raise exception 'Doar administratorii pot anula returnarea vestimentației.';
  end if;
  return new;
end; $$;

create or replace function public.prevent_lenjerie_revert() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.data_returnare is not null and new.data_returnare is null and not is_full_admin() then
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
declare v_inv_id text;
begin
  if new.cantitate_mingi > 0 then
    v_inv_id := case when new.marca_mingi = 'JOOLA' then 'inv-mingi-joola' else 'inv-mingi' end;
    update public.inventar set iesiri = iesiri + new.cantitate_mingi, updated_at = now() where id = v_inv_id;
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv)
      values (v_inv_id, 'iesire', new.cantitate_mingi, 'Mingi ' || new.marca_mingi || ' eliberate arbitrului ' || new.arbitru || ' (' || new.turneu || ')');
  end if;
  return new;
end; $$;

create or replace function public.ajusteaza_stoc_arbitraj_update() returns trigger language plpgsql security definer set search_path=public as $$
declare v_old_id text; v_new_id text;
begin
  if old.cantitate_mingi = new.cantitate_mingi and old.marca_mingi = new.marca_mingi then return new; end if;
  v_old_id := case when old.marca_mingi = 'JOOLA' then 'inv-mingi-joola' else 'inv-mingi' end;
  v_new_id := case when new.marca_mingi = 'JOOLA' then 'inv-mingi-joola' else 'inv-mingi' end;
  if old.cantitate_mingi > 0 then
    update public.inventar set iesiri = greatest(0, iesiri - old.cantitate_mingi), updated_at = now() where id = v_old_id;
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv)
    values (v_old_id, 'corectare', old.cantitate_mingi, 'Corecție mingi arbitraj pentru ' || old.arbitru || ' (' || old.turneu || '): anulare valoare anterioară');
  end if;
  if new.cantitate_mingi > 0 then
    update public.inventar set iesiri = iesiri + new.cantitate_mingi, updated_at = now() where id = v_new_id;
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv)
    values (v_new_id, 'iesire', new.cantitate_mingi, 'Mingi ' || new.marca_mingi || ' eliberate arbitrului ' || new.arbitru || ' (' || new.turneu || ')');
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
      data_solutionare = case when p_status='soluționat' then current_date else null end,
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

create or replace function public.get_resend_api_key() returns text language sql security definer set search_path='public, vault' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
$$;

-- triggers
create trigger trg_vestimentatie_stoc after insert on public.vestimentatie for each row execute function deduce_stoc_vestimentatie();
create trigger trg_vestimentatie_uzat_stoc after update of data_returnare on public.vestimentatie for each row execute function credit_stoc_uzat_vestimentatie();
create trigger trg_prevent_vestimentatie_revert before update on public.vestimentatie for each row execute function prevent_vestimentatie_revert();
create trigger trg_lenjerie_stoc after insert on public.lenjerie for each row execute function deduce_stoc_lenjerie();
create trigger trg_lenjerie_uzat_stoc after update of data_returnare on public.lenjerie for each row execute function credit_stoc_uzat_lenjerie();
create trigger trg_prevent_lenjerie_revert before update on public.lenjerie for each row execute function prevent_lenjerie_revert();
create trigger trg_arbitraj_stoc after insert on public.arbitraj for each row execute function deduce_stoc_arbitraj();
create trigger trg_arbitraj_stoc_update after update of cantitate_mingi, marca_mingi on public.arbitraj for each row execute function ajusteaza_stoc_arbitraj_update();
create trigger trg_atribuie_angajat_jurnal before insert on public.jurnal for each row execute function atribuie_angajat_jurnal_din_schimb();
create trigger trg_inregistreaza_schimb_finalizat after update of ended_at on public.sesiuni_schimb for each row
  when (old.ended_at is null and new.ended_at is not null) execute function inregistreaza_schimb_finalizat_in_serviciu();
