-- Helper account ("asistent"): reads players, teams, matches, statistics and payments,
-- never writes anything, never sees personal data, shift reports, hostel or observations.
--
-- Writes need no new policy: every insert/update/delete policy already requires
-- is_full_admin() (rol 'admin') or can_edit_register()/is_own_open_shift() (a 'locatie'
-- account with its own open shift), and only 'locatie' may open a shift. An asistent
-- therefore fails all of them by construction.

do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.administratori'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%rol%'
  loop
    execute format('alter table public.administratori drop constraint %I', c);
  end loop;
end $$;
alter table public.administratori
  add constraint administratori_rol_check check (rol in ('admin', 'locatie', 'asistent'));

-- admin or venue account: the people allowed to see personal data and shift paperwork
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.administratori where id = auth.uid() and rol in ('admin', 'locatie'));
$$;
revoke execute on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

-- full rows (IDNP, address, phone, ID card, medical, the whole personal file) only for staff
drop policy if exists "participanti: citire" on public.participanti;
create policy "participanti: citire" on public.participanti for select to authenticated
  using ((select public.is_staff()));
drop policy if exists "arbitri: citire" on public.arbitri;
create policy "arbitri: citire" on public.arbitri for select to authenticated
  using ((select public.is_staff()));

-- registers the helper has no reason to read
drop policy if exists "acte: citire" on public.acte_schimb;
create policy "acte: citire" on public.acte_schimb for select to authenticated
  using ((select public.is_staff()));
drop policy if exists "hostel: citire" on public.hostel;
create policy "hostel: citire" on public.hostel for select to authenticated
  using ((select public.is_staff()));
drop policy if exists "lenjerie: citire" on public.lenjerie;
create policy "lenjerie: citire" on public.lenjerie for select to authenticated
  using ((select public.is_staff()));
drop policy if exists "observatii: citire" on public.observatii;
create policy "observatii: citire" on public.observatii for select to authenticated
  using ((select public.is_staff()));

-- the helper's view of players / referees: sport data only, no personal fields
create or replace function public.participanti_asistent()
returns table (id uuid, nume text, prenume text, echipa_id uuid, nr_echipa smallint, rol_echipa text,
               rating integer, categorie_sportiva text, foto_path text, statut text,
               eligibil_antrenament boolean, data_inregistrarii date, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.nume, p.prenume, p.echipa_id, p.nr_echipa, p.rol_echipa, p.rating, p.categorie_sportiva,
         p.foto_path, p.statut, p.eligibil_antrenament, p.data_inregistrarii, p.created_at
    from public.participanti p
   where public.is_administrator()
   order by p.created_at desc;
$$;
create or replace function public.arbitri_asistent()
returns table (id uuid, nume text, prenume text, statut text, data_inregistrarii date, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.nume, a.prenume, a.statut, a.data_inregistrarii, a.created_at
    from public.arbitri a
   where public.is_administrator()
   order by a.created_at desc;
$$;
revoke execute on function public.participanti_asistent() from public, anon;
revoke execute on function public.arbitri_asistent() from public, anon;
grant execute on function public.participanti_asistent() to authenticated;
grant execute on function public.arbitri_asistent() to authenticated;

notify pgrst, 'reload schema';

-- Make every write by an asistent fail LOUDLY. RLS alone turns a forbidden UPDATE/DELETE
-- into "0 rows changed" without an error; a statement-level trigger fires even when no
-- row matches, so the app always gets an explicit refusal instead of a silent no-op.
create or replace function public.is_asistent()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.administratori where id = auth.uid() and rol = 'asistent');
$$;
revoke execute on function public.is_asistent() from public, anon;
grant execute on function public.is_asistent() to authenticated;

create or replace function public.blocheaza_scriere_asistent()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_asistent() then
    raise exception 'Contul de asistent are doar drept de citire (% pe %)', tg_op, tg_table_name
      using errcode = '42501';
  end if;
  return null;
end; $$;
revoke execute on function public.blocheaza_scriere_asistent() from public, anon, authenticated;

do $$
declare tbl text;
begin
  for tbl in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('drop trigger if exists trg_asistent_doar_citire on public.%I', tbl);
    execute format('create trigger trg_asistent_doar_citire before insert or update or delete or truncate on public.%I
                    for each statement execute function public.blocheaza_scriere_asistent()', tbl);
  end loop;
end $$;
