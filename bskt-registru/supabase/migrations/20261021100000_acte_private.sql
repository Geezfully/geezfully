-- Private storage for the beneficiary's signature + stamp printed on the "Act de prestare" PDF.
-- The image never goes to GitHub: it lives only in this bucket, and only a signed-in full admin can read it
-- (the app downloads it when it builds an act). Nobody can upload, change or delete it through the API —
-- it is replaced only with the service role (dashboard / one-off import).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('acte-private', 'acte-private', false, 2097152, array['image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "acte-private: citire admin" on storage.objects;
create policy "acte-private: citire admin" on storage.objects for select to authenticated
  using (bucket_id = 'acte-private' and (select public.is_full_admin()));
