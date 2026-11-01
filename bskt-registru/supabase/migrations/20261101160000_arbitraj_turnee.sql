-- Referees are paid per tournament: a month, a referee and how many tournaments, 750 lei gross each (637,50 net at 15%).
-- One row per referee per month, kept apart from public.arbitraj, the shift log of who stood on which pitch and which
-- balls they took. Shift rows stay as they are and no longer count towards pay, so nothing can be paid twice.
-- ore_total, added earlier today for typed hours, is removed; the guard stops this if anyone has used it since.

do $$ begin
  if exists (select 1 from public.arbitraj where ore_total is not null) then
    raise exception 'arbitraj.ore_total has data, move it to arbitraj_turnee first';
  end if;
end $$;
alter table public.arbitraj drop column ore_total;

create table public.arbitraj_turnee (
  id uuid primary key default gen_random_uuid(),
  arbitru_id uuid not null references public.arbitri(id) on delete restrict,
  luna text not null check (luna ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  turnee numeric(6,2) not null check (turnee > 0),
  created_at timestamptz not null default now(),
  unique (arbitru_id, luna)
);
comment on table public.arbitraj_turnee is 'Tournaments refereed per month; counted in the pay period that holds the last day of the month';

grant select, insert, update, delete on table public.arbitraj_turnee to authenticated;
grant all on table public.arbitraj_turnee to service_role;

alter table public.arbitraj_turnee enable row level security;
create policy "arbitraj_turnee: citire" on public.arbitraj_turnee for select to authenticated using ((select public.is_administrator()));
create policy "arbitraj_turnee: inserare admin" on public.arbitraj_turnee for insert to authenticated with check ((select public.is_full_admin()));
create policy "arbitraj_turnee: actualizare admin" on public.arbitraj_turnee for update to authenticated
  using ((select public.is_full_admin())) with check ((select public.is_full_admin()));
create policy "arbitraj_turnee: stergere admin" on public.arbitraj_turnee for delete to authenticated using ((select public.is_full_admin()));

create trigger trg_asistent_doar_citire before insert or update or delete or truncate on public.arbitraj_turnee
  for each statement execute function public.blocheaza_scriere_asistent();

-- "ora" stays until the new app version is live, so the page still open in browsers keeps reading its rate
update public.app_config set value = '{"ora":79.6875,"turneu":637.5,"retinerePct":15}', updated_at = now() where key = 'tarif_arbitri';

insert into public.jurnal (administrator_id, actiune) values (null,
  'Arbitrii se plătesc pe turneu: 750 lei brut (637,50 net, reținere 15%). Se introduc lună, arbitru și numărul de turnee; rândurile de pe schimb nu mai intră în plată.');
