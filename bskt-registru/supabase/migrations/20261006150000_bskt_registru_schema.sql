-- BSKT Pontaj — Registru electronic locație (BSKT Cup 3×3)
-- Cloned from ATTP Pontaj (see attp-pontaj/supabase/schema-snapshot-2026-10-06.sql) and adapted for basketball:
--   + echipe, meciuri, meci_jucatori, tarife_plata (match pay: căpitan / jucător / rezervă, net + 15% reținere)
--   + full "Fișa personală a sportivului" fields on participanti, player photos in storage
--   - Setka (table tennis rating) integration
--   venue / ball-brand / card CHECK lists from ATTP are replaced by free text driven by the UI.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ───────────────────────── accounts / roles ─────────────────────────
create table public.administratori (
  id uuid primary key references auth.users(id) on delete cascade,
  nume text not null, prenume text not null,
  created_at timestamptz not null default now(),
  ascuns boolean not null default false,
  rol text not null default 'admin' check (rol in ('admin','locatie'))
);

create table public.serviciu_administratori (
  id uuid primary key default gen_random_uuid(),
  nume text not null unique,
  activ boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.trusted_ips (
  id uuid primary key default gen_random_uuid(),
  ip text not null unique, eticheta text,
  adaugat_de uuid references public.administratori(id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.locatie_auth (
  id boolean primary key default true check (id),
  pin_hash text not null, updated_at timestamptz not null default now()
);
create table public.locatie_login_attempts (
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
create index sesiuni_schimb_administrator_idx on public.sesiuni_schimb(administrator_serviciu_id);
create index sesiuni_schimb_started_at_idx on public.sesiuni_schimb(started_at desc);

create table public.serviciu (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  administrator_id uuid references public.administratori(id),
  administrator_serviciu_id uuid references public.serviciu_administratori(id),
  inceput_la timestamptz, sfarsit_la timestamptz,
  created_at timestamptz not null default now()
);
create unique index serviciu_data_administrator_serviciu_uidx on public.serviciu(data, administrator_serviciu_id) where administrator_serviciu_id is not null;
create index serviciu_data_idx on public.serviciu(data);
create index serviciu_administrator_id_idx on public.serviciu(administrator_id);
create index serviciu_administrator_serviciu_id_idx on public.serviciu(administrator_serviciu_id);

create table public.acte_schimb (
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
create index acte_schimb_sesiune_idx on public.acte_schimb(sesiune_schimb_id);
create index acte_schimb_adm_serv_idx on public.acte_schimb(administrator_serviciu_id);
create index acte_schimb_adm_idx on public.acte_schimb(administrator_id);

-- ───────────────────────── teams & people ─────────────────────────
create table public.echipe (
  id uuid primary key default gen_random_uuid(),
  nume text not null unique,
  culoare text,
  activ boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.participanti (
  id uuid primary key default gen_random_uuid(),
  -- 1. identitate
  nume text not null, prenume text not null, patronimic text,
  -- 2–8. date personale / act
  data_nasterii date, loc_nastere text,
  adresa text, idnp text,
  telefon text, contact_rezerva text, persoana_contact text, email text,
  serie_act text, nr_act text, data_emiterii_act date,
  stagiu_sportiv_ani int check (stagiu_sportiv_ani is null or stagiu_sportiv_ani >= 0),
  -- 9–11. activitate
  loc_munca text, functia text, profil_activitate text,
  -- 12–17. sport
  club text,
  echipa_id uuid references public.echipe(id) on delete set null,
  nr_echipa smallint check (nr_echipa is null or nr_echipa between 1 and 4),
  rol_echipa text not null default 'jucător' check (rol_echipa in ('căpitan','jucător','arbitru')),
  clasament text,
  categorie_sportiva text check (categorie_sportiva is null or categorie_sportiva in ('MS','CMS','Categoria I','Categoria II','Categoria III','Amator')),
  -- 18–20. recomandări
  primul_antrenor text, recomandator text, garant_integritate text,
  -- 21–23. fizic
  inaltime_cm int check (inaltime_cm is null or inaltime_cm between 100 and 250),
  greutate_kg int check (greutate_kg is null or greutate_kg between 30 and 200),
  marime text check (marime is null or marime in ('S','M','L','XL','XXL','XXXL')),
  -- 24–30. istoric / integritate
  rezultate_sport text, traumatisme text, contraindicatii text, alt_sport text,
  experienta_competitii text, contacte_pariuri text, experienta_pariere text,
  caracteristica text,
  -- 31–33. acorduri
  informat_securitate boolean not null default false,
  acord_date_personale boolean not null default false,
  comentarii text,
  -- registru
  rating int check (rating is null or rating between 0 and 100),
  foto_path text,
  nr_dulap text,
  data_aviz_medical date,
  statut text not null default 'activ' check (statut in ('activ','inactiv')),
  eligibil_antrenament boolean not null default false,
  data_inregistrarii date not null default current_date,
  created_at timestamptz not null default now()
);
create unique index participanti_idnp_key on public.participanti(idnp) where idnp is not null;
create index participanti_statut_idx on public.participanti(statut);
create index participanti_echipa_idx on public.participanti(echipa_id);

create table public.arbitri (
  id uuid primary key default gen_random_uuid(),
  nr_dulap text, nume text not null, prenume text not null,
  data_nasterii date, adresa text, telefon text, email text, data_aviz_medical date,
  statut text not null default 'activ' check (statut in ('activ','inactiv')),
  data_inregistrarii date not null default current_date,
  created_at timestamptz not null default now()
);

-- ───────────────────────── matches & pay ─────────────────────────
create table public.meciuri (
  id uuid primary key default gen_random_uuid(),
  nr int unique,                                  -- official match number (#75, #76 …)
  data date not null default current_date,
  ora time,
  teren text,
  echipa_a_id uuid not null references public.echipe(id),
  echipa_b_id uuid not null references public.echipe(id),
  scor_a int check (scor_a is null or scor_a >= 0),
  scor_b int check (scor_b is null or scor_b >= 0),
  prelungiri boolean not null default false,
  arbitru text,
  observatii text,
  sesiune_schimb_id uuid references public.sesiuni_schimb(id) on delete set null,
  created_at timestamptz not null default now(),
  check (echipa_a_id <> echipa_b_id),
  check (scor_a is null or scor_b is null or scor_a <> scor_b)   -- 3×3 has no draws
);
create index meciuri_data_idx on public.meciuri(data desc);
create index meciuri_echipa_a_idx on public.meciuri(echipa_a_id);
create index meciuri_echipa_b_idx on public.meciuri(echipa_b_id);
create index meciuri_sesiune_idx on public.meciuri(sesiune_schimb_id);

create table public.meci_jucatori (
  id uuid primary key default gen_random_uuid(),
  meci_id uuid not null references public.meciuri(id) on delete cascade,
  echipa_id uuid not null references public.echipe(id),
  participant_id uuid not null references public.participanti(id),
  rol text not null default 'jucător' check (rol in ('căpitan','jucător','rezervă')),
  -- pay frozen when the match gets a result (see trg_meci_plati); null while the score is missing
  suma_net numeric(10,2),
  suma_bruta numeric(10,2),
  retinere numeric(10,2),
  created_at timestamptz not null default now(),
  unique (meci_id, participant_id)
);
create unique index meci_jucatori_un_capitan on public.meci_jucatori(meci_id, echipa_id) where rol = 'căpitan';
create index meci_jucatori_participant_idx on public.meci_jucatori(participant_id);
create index meci_jucatori_echipa_idx on public.meci_jucatori(echipa_id);

-- Rates by role and outcome, valid from a date (newest row with valabil_de_la <= match date wins).
-- Net is what the player receives; brut = net / (1 - retinere_pct/100).
create table public.tarife_plata (
  id uuid primary key default gen_random_uuid(),
  valabil_de_la date not null,
  rol text not null check (rol in ('căpitan','jucător','rezervă')),
  situatie text not null check (situatie in ('victorie','înfrângere')),
  net numeric(10,2) not null check (net >= 0),
  retinere_pct numeric(5,2) not null default 15 check (retinere_pct >= 0 and retinere_pct < 100),
  observatie text,
  created_at timestamptz not null default now(),
  unique (valabil_de_la, rol, situatie)
);

-- ───────────────────────── registers (as in ATTP) ─────────────────────────
create table public.intarzieri (id uuid primary key default gen_random_uuid(),
  participant_id uuid references public.participanti(id) on delete cascade, arbitru text,
  data date not null default current_date, minute_intarziere int, motiv text,
  created_at timestamptz not null default now());
create index intarzieri_participant_id_idx on public.intarzieri(participant_id);
create index intarzieri_data_idx on public.intarzieri(data);

create table public.inventar (
  id text primary key, denumire text not null, culoare text, marime text,
  um text not null default 'buc', cantitate_initiala int not null default 0,
  intrari int not null default 0, iesiri int not null default 0,
  cantitate_curenta int generated always as (cantitate_initiala + intrari - iesiri) stored,
  cantitate_minima int not null default 0, stare text not null default 'bună', observatii text,
  updated_at timestamptz not null default now(),
  conditie text not null default 'nou' check (conditie in ('nou','uzat')),
  -- for 'nou' items that can be returned: the matching 'uzat' item returns go into
  pereche_uzat_id text references public.inventar(id));
create table public.inventar_miscari (id uuid primary key default gen_random_uuid(),
  inventar_id text not null references public.inventar(id),
  tip text not null check (tip in ('intrare','iesire','corectare')),
  cantitate int not null, motiv text, administrator_id uuid references public.administratori(id) on delete set null,
  created_at timestamptz not null default now());
create index inventar_miscari_inventar_id_idx on public.inventar_miscari(inventar_id);
create index inventar_miscari_administrator_id_idx on public.inventar_miscari(administrator_id);

-- clothing now points straight at an inventory item instead of parsing "Maiou roșu" strings
create table public.vestimentatie (id uuid primary key default gen_random_uuid(),
  participant_id uuid references public.participanti(id) on delete cascade, arbitru text,
  inventar_id text references public.inventar(id),
  data date not null default current_date,
  tip text not null, culoare text, marime text, cantitate int not null default 1 check (cantitate > 0),
  data_returnare date, stare_returnare text, created_at timestamptz not null default now());
create index vestimentatie_participant_id_idx on public.vestimentatie(participant_id);
create index vestimentatie_inventar_id_idx on public.vestimentatie(inventar_id);

create table public.spalatorie (id uuid primary key default gen_random_uuid(),
  participant_id uuid references public.participanti(id) on delete cascade, data date not null default current_date,
  tip_articole text, suma numeric not null default 0, cantitate int not null default 1,
  data_returnare date, created_at timestamptz not null default now());
create index spalatorie_participant_id_idx on public.spalatorie(participant_id);

create table public.hostel (id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participanti(id) on delete cascade, data_cazare date not null default current_date,
  observatii text, statut text not null default 'închis' check (statut in ('activ','închis')),
  created_at timestamptz not null default now());
create index hostel_participant_id_idx on public.hostel(participant_id);

create table public.lenjerie (id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participanti(id) on delete cascade, data_eliberare date not null default current_date,
  data_returnare date, sursa_stoc text not null default 'nou' check (sursa_stoc in ('nou','uzat')),
  created_at timestamptz not null default now());
create index lenjerie_participant_id_idx on public.lenjerie(participant_id);

create table public.daune (id uuid primary key default gen_random_uuid(),
  data date not null default current_date, participant_id uuid not null references public.participanti(id) on delete cascade,
  inventar_afectat text, natura text, stare text check (stare in ('afectat','deteriorat','distrus')),
  observatii text, valoare_estimata numeric not null default 0,
  administrator_serviciu_avertizor_id uuid references public.serviciu_administratori(id),
  admin_avertizor_id uuid references public.administratori(id) on delete set null,
  teren text,
  created_at timestamptz not null default now());
create index daune_participant_id_idx on public.daune(participant_id);
create index daune_adm_serv_idx on public.daune(administrator_serviciu_avertizor_id);
create index daune_admin_idx on public.daune(admin_avertizor_id);

-- referee on duty per shift slot + basketballs handed out
create table public.arbitraj (id uuid primary key default gen_random_uuid(),
  data date not null default current_date, arbitru text not null,
  turneu text not null,                                  -- court / session label from the UI
  cantitate_mingi int not null default 0 check (cantitate_mingi >= 0),
  observatii text, sesiune_schimb_id uuid references public.sesiuni_schimb(id) on delete set null,
  slot_schimb smallint check (slot_schimb between 1 and 3),
  created_at timestamptz not null default now());
create unique index arbitraj_sesiune_slot_uidx on public.arbitraj(sesiune_schimb_id, slot_schimb) where sesiune_schimb_id is not null and slot_schimb is not null;
create index arbitraj_sesiune_schimb_id_idx on public.arbitraj(sesiune_schimb_id);

-- fair play adapted to basketball sanctions
create table public.fair_play (id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participanti(id) on delete cascade,
  meci_id uuid references public.meciuri(id) on delete set null,
  data date not null default current_date, ora time,
  platou text,
  descriere text,
  tip_cartonas text not null check (tip_cartonas in ('avertisment','fault tehnic','fault antisportiv','descalificare')),
  created_at timestamptz not null default now());
create index fair_play_participant_idx on public.fair_play(participant_id);
create index fair_play_meci_idx on public.fair_play(meci_id);

create table public.treninguri (id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participanti(id) on delete cascade, antrenor text not null,
  data date not null, ora time, suma_jucator numeric not null default 100, suma_antrenor numeric not null default 200,
  observatii text, created_at timestamptz not null default now());
create index treninguri_participant_idx on public.treninguri(participant_id);

create table public.observatii (id uuid primary key default gen_random_uuid(),
  data date not null default current_date, participant_id uuid references public.participanti(id) on delete cascade,
  categorie text not null, subiect text, descriere text, created_at timestamptz not null default now());
create index observatii_participant_id_idx on public.observatii(participant_id);

create table public.pauze_tehnice (id uuid primary key default gen_random_uuid(),
  data date not null default current_date, ora_start time not null, ora_stop time not null,
  teren text not null, descriere text not null, created_at timestamptz not null default now());
create index pauze_tehnice_data_idx on public.pauze_tehnice(data desc);

create table public.sarcini (id uuid primary key default gen_random_uuid(),
  data_inreg date not null default current_date, admin_inreg_id uuid references public.administratori(id) on delete set null,
  descriere text not null,
  status text not null default 'nesoluționat' check (status in ('nesoluționat','în lucru','soluționat')),
  actiuni text, data_solutionare date, admin_solutionare_id uuid references public.administratori(id) on delete set null,
  administrator_serviciu_inreg_id uuid references public.serviciu_administratori(id),
  administrator_serviciu_solutionare_id uuid references public.serviciu_administratori(id),
  created_at timestamptz not null default now());
create index sarcini_admin_inreg_idx on public.sarcini(admin_inreg_id);
create index sarcini_admin_sol_idx on public.sarcini(admin_solutionare_id);
create index sarcini_serv_inreg_idx on public.sarcini(administrator_serviciu_inreg_id);
create index sarcini_serv_sol_idx on public.sarcini(administrator_serviciu_solutionare_id);

create table public.sarcini_istoric_status (id uuid primary key default gen_random_uuid(),
  sarcina_id uuid not null references public.sarcini(id) on delete cascade,
  status_vechi text not null check (status_vechi in ('nesoluționat','în lucru','soluționat')),
  status_nou text not null check (status_nou in ('nesoluționat','în lucru','soluționat')),
  cont_id uuid not null references public.administratori(id),
  administrator_serviciu_id uuid references public.serviciu_administratori(id),
  schimbat_la timestamptz not null default now());
create index sarcini_istoric_status_sarcina_idx on public.sarcini_istoric_status(sarcina_id, schimbat_la desc);
create index sarcini_istoric_status_cont_idx on public.sarcini_istoric_status(cont_id);
create index sarcini_istoric_status_serv_idx on public.sarcini_istoric_status(administrator_serviciu_id);

create table public.jurnal (id uuid primary key default gen_random_uuid(),
  administrator_id uuid references public.administratori(id) on delete set null, actiune text not null,
  data timestamptz not null default now(),
  administrator_serviciu_id uuid references public.serviciu_administratori(id));
create index jurnal_data_idx on public.jurnal(data desc);
create index jurnal_administrator_id_idx on public.jurnal(administrator_id);
create index jurnal_administrator_serviciu_id_idx on public.jurnal(administrator_serviciu_id);

create table public.app_config (key text primary key, value text not null, updated_at timestamptz not null default now());
create table public.location_refresh_events (id uuid primary key default gen_random_uuid(),
  scheduled_at timestamptz not null, expires_at timestamptz not null,
  requires_active_shift boolean not null default true, created_at timestamptz not null default now());
