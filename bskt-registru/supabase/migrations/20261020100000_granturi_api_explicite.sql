-- Explicit Data API grants for every table that exists on 20.10.2026.
--
-- Until 30.10.2026 Supabase gave every new table in "public" full access for anon / authenticated /
-- service_role through default privileges, and none of the earlier migrations grant anything themselves.
-- After that date a schema rebuilt from these migrations (new project, branch, `supabase db reset`) would
-- get tables the Data API cannot reach ("permission denied"). This file restores exactly the access the
-- live database has today. Row Level Security still decides which rows each role may see or change.
--
-- From now on every migration that creates a table grants access right after it, e.g.
--   grant select, insert, update, delete on public.<table> to authenticated;
--   grant all on public.<table> to service_role;
-- (anon only when the signed-out login page genuinely needs it).

grant all on table public.administratori          to anon, authenticated, service_role;
grant all on table public.serviciu_administratori to anon, authenticated, service_role;
grant all on table public.trusted_ips             to anon, authenticated, service_role;
grant all on table public.locatie_auth            to anon, authenticated, service_role;
grant all on table public.locatie_login_attempts  to anon, authenticated, service_role;
grant all on table public.sesiuni_schimb          to anon, authenticated, service_role;
grant all on table public.serviciu                to anon, authenticated, service_role;
grant all on table public.acte_schimb             to anon, authenticated, service_role;
grant all on table public.echipe                  to anon, authenticated, service_role;
grant all on table public.participanti            to anon, authenticated, service_role;
grant all on table public.arbitri                 to anon, authenticated, service_role;
grant all on table public.meciuri                 to anon, authenticated, service_role;
grant all on table public.meci_jucatori           to anon, authenticated, service_role;
grant all on table public.tarife_plata            to anon, authenticated, service_role;
grant all on table public.intarzieri              to anon, authenticated, service_role;
grant all on table public.inventar                to anon, authenticated, service_role;
grant all on table public.inventar_miscari        to anon, authenticated, service_role;
grant all on table public.vestimentatie           to anon, authenticated, service_role;
grant all on table public.spalatorie              to anon, authenticated, service_role;
grant all on table public.hostel                  to anon, authenticated, service_role;
grant all on table public.lenjerie                to anon, authenticated, service_role;
grant all on table public.daune                   to anon, authenticated, service_role;
grant all on table public.arbitraj                to anon, authenticated, service_role;
grant all on table public.fair_play               to anon, authenticated, service_role;
grant all on table public.treninguri              to anon, authenticated, service_role;
grant all on table public.observatii              to anon, authenticated, service_role;
grant all on table public.pauze_tehnice           to anon, authenticated, service_role;
grant all on table public.sarcini                 to anon, authenticated, service_role;
grant all on table public.sarcini_istoric_status  to anon, authenticated, service_role;
grant all on table public.jurnal                  to anon, authenticated, service_role;
grant all on table public.app_config              to anon, authenticated, service_role;
grant all on table public.location_refresh_events to anon, authenticated, service_role;
grant all on table public.sync_rezultate          to anon, authenticated, service_role;
grant all on table public.conturi_permise         to anon, authenticated, service_role;
grant all on table public.modificari_asistent     to anon, authenticated, service_role;
grant all on table public.invitatii               to anon, authenticated, service_role;
grant all on table public.tabel_jucatori          to anon, authenticated, service_role;
grant all on table public.tabel_config            to anon, authenticated, service_role;
grant all on table public.meciuri_sterse          to anon, authenticated, service_role;
grant all on table public.saptamani_blocate       to anon, authenticated, service_role;
grant all on table public.saptamani_auto_blocate  to anon, authenticated, service_role;
grant all on table public.zile_avertizari         to anon, authenticated, service_role;

-- counters behind the auto-numbered id columns
grant usage, select, update on sequence public.sync_rezultate_id_seq      to anon, authenticated, service_role;
grant usage, select, update on sequence public.modificari_asistent_id_seq to anon, authenticated, service_role;
