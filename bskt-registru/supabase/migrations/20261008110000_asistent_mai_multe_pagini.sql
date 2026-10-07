-- Helper (asistent) may now open hostel, linen, observations, medical, kit and the other
-- registers (still read-only: the statement trigger refuses every write). Personal data
-- stays server-side: the helper still reads players only through participanti_asistent(),
-- which now also returns the medical-certificate date, locker number and kit size.
drop policy if exists "hostel: citire" on public.hostel;
create policy "hostel: citire" on public.hostel for select to authenticated using ((select public.is_administrator()));
drop policy if exists "lenjerie: citire" on public.lenjerie;
create policy "lenjerie: citire" on public.lenjerie for select to authenticated using ((select public.is_administrator()));
drop policy if exists "observatii: citire" on public.observatii;
create policy "observatii: citire" on public.observatii for select to authenticated using ((select public.is_administrator()));

drop function if exists public.participanti_asistent();
create function public.participanti_asistent()
returns table (id uuid, nume text, prenume text, echipa_id uuid, nr_echipa smallint, rol_echipa text,
               rating integer, categorie_sportiva text, foto_path text, statut text,
               eligibil_antrenament boolean, data_inregistrarii date, created_at timestamptz,
               data_aviz_medical date, nr_dulap text, marime text)
language sql stable security definer set search_path = public as $$
  select p.id, p.nume, p.prenume, p.echipa_id, p.nr_echipa, p.rol_echipa, p.rating, p.categorie_sportiva,
         p.foto_path, p.statut, p.eligibil_antrenament, p.data_inregistrarii, p.created_at,
         p.data_aviz_medical, p.nr_dulap, p.marime
    from public.participanti p
   where public.is_administrator()
   order by p.created_at desc;
$$;
revoke execute on function public.participanti_asistent() from public, anon;
grant execute on function public.participanti_asistent() to authenticated;
notify pgrst, 'reload schema';
