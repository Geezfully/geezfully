-- Pauză tehnică: întârzierile de la începutul meciurilor (interval orar, teren, motiv).
-- Aceleași reguli de acces ca la fair_play / observatii: citesc toți administratorii,
-- inserează doar registrul cu schimb deschis, șterge doar administratorul complet.
begin;

create table if not exists public.pauze_tehnice (
  id uuid primary key default gen_random_uuid(),
  data date not null default current_date,
  ora_start time without time zone not null,
  ora_stop time without time zone not null,
  teren text not null,
  descriere text not null,
  created_at timestamptz not null default now()
);

create index if not exists pauze_tehnice_data_idx on public.pauze_tehnice (data desc);

alter table public.pauze_tehnice enable row level security;

drop policy if exists "pauze tehnice: citire" on public.pauze_tehnice;
create policy "pauze tehnice: citire"
on public.pauze_tehnice
for select
to authenticated
using ((select public.is_administrator()));

drop policy if exists "pauze tehnice: inserare" on public.pauze_tehnice;
create policy "pauze tehnice: inserare"
on public.pauze_tehnice
for insert
to authenticated
with check ((select public.can_edit_register()));

drop policy if exists "pauze tehnice: actualizare admin" on public.pauze_tehnice;
create policy "pauze tehnice: actualizare admin"
on public.pauze_tehnice
for update
to authenticated
using ((select public.is_full_admin()))
with check ((select public.is_full_admin()));

drop policy if exists "pauze tehnice: stergere admin" on public.pauze_tehnice;
create policy "pauze tehnice: stergere admin"
on public.pauze_tehnice
for delete
to authenticated
using ((select public.is_full_admin()));

commit;
