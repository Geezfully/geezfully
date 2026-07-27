-- Shift reports need the exact timestamp at which a task became solved so they can
-- carry unfinished tasks forward while showing completed tasks only in the solving shift.
-- Every authenticated register user can already read the corresponding task rows.
drop policy if exists "sarcini istoric: citire admin" on public.sarcini_istoric_status;
drop policy if exists "sarcini istoric: citire registru" on public.sarcini_istoric_status;

create policy "sarcini istoric: citire registru"
on public.sarcini_istoric_status
for select
to authenticated
using ((select public.is_administrator()));
