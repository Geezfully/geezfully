-- Security hardening (07.10).
-- Public sign-up is open in Supabase Auth (and auto-confirmed), so anyone holding the public key could create
-- an account. Such an account already saw no data (every policy requires an administratori row), but nobody
-- should be able to get an account at all: only allow-listed e-mails can be created, whatever the Auth setting.

create table if not exists public.conturi_permise (
  email text primary key check (email = lower(email)),
  observatie text,
  created_at timestamptz not null default now()
);
alter table public.conturi_permise enable row level security;
create policy "conturi_permise: doar admin" on public.conturi_permise for all to authenticated
  using ((select public.is_full_admin())) with check ((select public.is_full_admin()));

-- the accounts that exist today + the on-site tablet account (provisioned by location-login)
insert into public.conturi_permise (email, observatie)
select lower(email), 'cont existent la 07.10.2026' from auth.users
on conflict (email) do nothing;
insert into public.conturi_permise (email, observatie) values ('locatie@bskt-pontaj.internal', 'contul tabletei (PIN)')
on conflict (email) do nothing;

create or replace function public.blocheaza_conturi_nepermise() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.email is null or not exists (select 1 from public.conturi_permise where email = lower(new.email)) then
    raise exception 'Crearea contului nu este permisă: adresa nu este în lista conturilor permise.' using errcode = '42501';
  end if;
  return new;
end; $$;
revoke execute on function public.blocheaza_conturi_nepermise() from public, anon, authenticated;

drop trigger if exists trg_blocheaza_conturi_nepermise on auth.users;
create trigger trg_blocheaza_conturi_nepermise before insert on auth.users
  for each row execute function public.blocheaza_conturi_nepermise();

-- settings & refresh events were readable by any signed-in account; restrict them to registry accounts
drop policy if exists "app_config: citire" on public.app_config;
create policy "app_config: citire" on public.app_config for select to authenticated using ((select public.is_administrator()));
drop policy if exists "refresh: citire" on public.location_refresh_events;
create policy "refresh: citire" on public.location_refresh_events for select to authenticated using ((select public.is_administrator()));
