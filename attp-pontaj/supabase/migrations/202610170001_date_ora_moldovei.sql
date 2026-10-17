-- Dates in Moldova time. The database server runs in UTC, so between midnight and
-- 02:00/03:00 in Moldova current_date is still the previous day. Changed here:
--   * schimba_status_sarcina: the day a task is solved is Moldova's calendar day;
--   * column defaults (used when the app sends no date) use Moldova's day.
-- Shift-based dates are unaffected (serviciu already uses the Moldova date the shift
-- started). No existing row is modified.
begin;

alter table public.sarcini alter column data_inreg set default public.moldova_today();
alter table public.lenjerie alter column data_eliberare set default public.moldova_today();
alter table public.participanti alter column data_inregistrarii set default public.moldova_today();
alter table public.vestimentatie alter column data set default public.moldova_today();
alter table public.hostel alter column data_cazare set default public.moldova_today();
alter table public.spalatorie alter column data set default public.moldova_today();
alter table public.daune alter column data set default public.moldova_today();
alter table public.arbitraj alter column data set default public.moldova_today();
alter table public.intarzieri alter column data set default public.moldova_today();
alter table public.arbitri alter column data_inregistrarii set default public.moldova_today();
alter table public.acte_schimb alter column data set default public.moldova_today();
alter table public.fair_play alter column data set default public.moldova_today();
alter table public.pauze_tehnice alter column data set default public.moldova_today();
alter table public.observatii alter column data set default public.moldova_today();

-- same function as before, only current_date -> public.moldova_today()
DO $mig$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.schimba_status_sarcina(uuid,text)'::regprocedure);
  if position('current_date' in v_def) = 0 then raise exception 'unexpected definition'; end if;
  execute replace(v_def, 'current_date', 'public.moldova_today()');
end $mig$;

commit;
