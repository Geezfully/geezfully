-- Fifth "Alte compensări" box: Altele, typed by hand for special cases, kept
-- apart from the regular manual amount. Like the others it is part of the one
-- total the act and the CSV show:
--   alte_compensari = manual + altele + spalatorie + daune + antrenamente
--
-- Also stops reading a bare edit of the total as a manual edit (see below).
begin;

alter table public.monthly_entries
  add column if not exists alte_compensari_altele numeric not null default 0;

create or replace function public.monthly_entries_alte_compensari_total()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_from_sync boolean := coalesce(current_setting('setka.attp_sync', true), '') = 'on';
begin
  if not v_from_sync then
    if tg_op = 'UPDATE' then
      new.alte_compensari_spalatorie := old.alte_compensari_spalatorie;
      new.alte_compensari_daune := old.alte_compensari_daune;
      new.alte_compensari_antrenamente := old.alte_compensari_antrenamente;
      -- A write to the total alone is ignored: the total is always recomputed.
      -- (Until now it was read as a manual edit, for page builds from before the
      -- boxes existed. A tab left open on such a build then reset the manual
      -- amount when it saved a stale total, so that compatibility is dropped.)
    else
      new.alte_compensari_spalatorie := 0;
      new.alte_compensari_daune := 0;
      new.alte_compensari_antrenamente := 0;
      if coalesce(new.alte_compensari_manual, 0) = 0 and coalesce(new.alte_compensari_altele, 0) = 0 then
        new.alte_compensari_manual := coalesce(new.alte_compensari, 0);
      end if;
    end if;
  end if;

  new.alte_compensari_manual := abs(coalesce(new.alte_compensari_manual, 0));
  new.alte_compensari_altele := abs(coalesce(new.alte_compensari_altele, 0));
  new.alte_compensari := new.alte_compensari_manual + new.alte_compensari_altele
    + new.alte_compensari_spalatorie + new.alte_compensari_daune + new.alte_compensari_antrenamente;
  return new;
end;
$$;

revoke all on function public.monthly_entries_alte_compensari_total() from public, anon, authenticated;

commit;
