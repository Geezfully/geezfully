-- One-off, September 2026 business period only (28 Aug - 30 Sep).
--
-- August 2026 was paid out as TOTAL SPRE PLATĂ + impozit instead of the total,
-- so everyone received 15% of their August total too much. That 15% is taken
-- back from September by putting it in the "Altele" box, which the act
-- subtracts from the total like every other Alte compensări amount.
--
-- August total = entry_totals.total_fee for 2026-08-01, the same figure the act
-- prints as TOTAL SPRE PLATĂ (item rows at the month's category rates minus
-- Alte compensări). No August acts were saved, so this is recomputed, not read.
--
-- Nothing but the September Altele amount (and the total derived from it)
-- changes. Rows are updated with triggers bypassed so updated_at stays as it
-- was; the total is recomputed exactly as the total trigger does.
--
-- People with no September row yet get none created: the amount waits in
-- recuperare_impozit_aug_2026 and a BEFORE INSERT trigger puts it in Altele the
-- moment their September row is first created. It only ever acts on period
-- 2026-09-01, so it does nothing afterwards.
--
-- Undo: set alte_compensari_altele = 0 on the September rows listed in the
-- table (all September Altele amounts were 0 before this), recompute the total,
-- then drop the trigger, function and table.
begin;

create table public.recuperare_impozit_aug_2026 (
  referee_id uuid primary key references public.referees(id) on delete cascade,
  total_august numeric not null,
  suma numeric not null,
  aplicat_la timestamptz,
  created_at timestamptz not null default now()
);
alter table public.recuperare_impozit_aug_2026 enable row level security;
create policy recuperare_impozit_aug_2026_approved_select on public.recuperare_impozit_aug_2026
  for select to authenticated using (public.is_approved());
revoke all on public.recuperare_impozit_aug_2026 from anon, authenticated;
grant select on public.recuperare_impozit_aug_2026 to authenticated;

insert into public.recuperare_impozit_aug_2026 (referee_id, total_august, suma)
select et.referee_id, et.total_fee, round(et.total_fee * 0.15, 2)
  from public.entry_totals et
 where et.period = date '2026-08-01'
   and et.total_fee > 0;

-- Existing September rows: only Altele and the derived total change.
set local session_replication_role = replica;
update public.monthly_entries me
   set alte_compensari_altele = r.suma,
       alte_compensari = me.alte_compensari_manual + r.suma + me.alte_compensari_spalatorie
                       + me.alte_compensari_daune + me.alte_compensari_antrenamente
  from public.recuperare_impozit_aug_2026 r
 where me.referee_id = r.referee_id
   and me.period = date '2026-09-01';
set local session_replication_role = origin;

update public.recuperare_impozit_aug_2026 r
   set aplicat_la = now()
 where exists (select 1 from public.monthly_entries me
                where me.referee_id = r.referee_id and me.period = date '2026-09-01');

-- September rows created later. Named to sort before
-- monthly_entries_alte_compensari_total, so the total includes it.
create or replace function public.monthly_entries_recuperare_impozit_aug_2026()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_suma numeric;
begin
  if new.period = date '2026-09-01' and coalesce(new.alte_compensari_altele, 0) = 0 then
    select suma into v_suma from recuperare_impozit_aug_2026
     where referee_id = new.referee_id and aplicat_la is null;
    if v_suma is not null then
      new.alte_compensari_altele := v_suma;
      update recuperare_impozit_aug_2026 set aplicat_la = now() where referee_id = new.referee_id;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.monthly_entries_recuperare_impozit_aug_2026() from public, anon, authenticated;

create trigger monthly_entries_a0_recuperare_impozit_aug_2026
before insert on public.monthly_entries
for each row execute function public.monthly_entries_recuperare_impozit_aug_2026();

commit;
