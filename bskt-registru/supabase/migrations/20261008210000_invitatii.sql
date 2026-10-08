-- One-time sign-up links. A full admin creates a link for a role (admin or asistent); the invitee opens it,
-- types display name + e-mail + password, and the accept-invite edge function creates the account.
-- Only the SHA-256 of the token is stored; the token itself is shown to the admin once.
-- Public sign-up stays locked (conturi_permise allowlist): accept-invite adds the e-mail just before creating the user.

create table if not exists public.invitatii (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  rol text not null check (rol in ('admin','asistent')),
  limba text not null default 'ro' check (limba in ('ro','ru')),
  creat_de uuid references public.administratori(id) on delete set null,
  creat_la timestamptz not null default now(),
  expira_la timestamptz not null,
  folosita_la timestamptz,
  anulata_la timestamptz,
  email text,
  nume_afisat text,
  cont_id uuid references auth.users(id) on delete set null
);
create index if not exists invitatii_creat_la_idx on public.invitatii(creat_la desc);
alter table public.invitatii enable row level security;
create policy "invitatii: citire admin" on public.invitatii for select to authenticated using ((select public.is_full_admin()));
-- no insert/update/delete policies: only the functions below (and the edge function, as service role) write

create or replace function public.creeaza_invitatie(p_rol text, p_zile int default 7, p_limba text default 'ro')
returns table(id uuid, token text, expira_la timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := encode(extensions.gen_random_bytes(24), 'hex');
        v_id uuid; v_exp timestamptz;
begin
  if not public.is_full_admin() then raise exception 'Doar administratorii pot crea invitații'; end if;
  if p_rol not in ('admin','asistent') then raise exception 'Rol invalid'; end if;
  if p_limba not in ('ro','ru') then raise exception 'Limbă invalidă'; end if;
  if p_zile is null or p_zile < 1 or p_zile > 30 then raise exception 'Valabilitatea trebuie să fie între 1 și 30 de zile'; end if;
  insert into public.invitatii (token_hash, rol, limba, creat_de, expira_la)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), p_rol, p_limba, auth.uid(), now() + make_interval(days => p_zile))
  returning invitatii.id, invitatii.expira_la into v_id, v_exp;
  insert into public.jurnal (administrator_id, actiune)
  values (auth.uid(), 'A creat o invitație de înregistrare (' || case when p_rol = 'admin' then 'administrator' else 'asistent' end || ', ' || p_zile || case when p_zile = 1 then ' zi)' else ' zile)' end);
  return query select v_id, v_token, v_exp;
end; $$;

create or replace function public.anuleaza_invitatie(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_full_admin() then raise exception 'Doar administratorii pot anula invitații'; end if;
  update public.invitatii set anulata_la = now() where id = p_id and folosita_la is null and anulata_la is null;
  if not found then raise exception 'Invitația nu mai este activă'; end if;
  insert into public.jurnal (administrator_id, actiune) values (auth.uid(), 'A anulat o invitație de înregistrare');
end; $$;

revoke execute on function public.creeaza_invitatie(text, int, text), public.anuleaza_invitatie(uuid) from public, anon;
grant execute on function public.creeaza_invitatie(text, int, text), public.anuleaza_invitatie(uuid) to authenticated;
