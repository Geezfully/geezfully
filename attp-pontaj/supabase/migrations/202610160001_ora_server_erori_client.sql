-- Two additions for a sturdier location computer. Nothing existing is changed.
--
-- 1. ora_server(): the database clock. The location PC's clock runs a few
--    minutes slow, so the end of a shift (and of its report window) must come
--    from the server, not from the PC. Read-only.
--
-- 2. erori_client: when the app on a register computer cannot reach the server,
--    loses its session or fails to save, it writes a short entry here (queued on
--    the PC while offline, sent once the connection is back). Only full admins
--    can read it; each account can only add rows under its own id.
begin;

create or replace function public.ora_server()
returns timestamptz
language sql
stable
as $$ select now() $$;

revoke all on function public.ora_server() from public, anon;
grant execute on function public.ora_server() to authenticated;

create table if not exists public.erori_client (
  id                 bigint generated always as identity primary key,
  created_at         timestamptz not null default now(),   -- when the server received it
  ora_client         timestamptz,                          -- the PC's own clock at the time
  cont_id            uuid not null default auth.uid(),
  sesiune_schimb_id  uuid,
  actiune            text not null,                        -- e.g. incarcare_date, inchidere_schimb
  mesaj              text,
  detalii            jsonb,
  user_agent         text
);
create index if not exists erori_client_created_idx on public.erori_client (created_at desc);

alter table public.erori_client enable row level security;

drop policy if exists "erori client: inserare proprie" on public.erori_client;
create policy "erori client: inserare proprie" on public.erori_client
  for insert to authenticated
  with check (cont_id = (select auth.uid()) and (select is_administrator()));

drop policy if exists "erori client: citire admin" on public.erori_client;
create policy "erori client: citire admin" on public.erori_client
  for select to authenticated using ((select is_full_admin()));

commit;
