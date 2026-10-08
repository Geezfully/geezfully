-- Referee profiles get the same ID-card fields the players' personal file uses
-- (IDNP, document number, issue date). Staff-only like the rest of the arbitri row:
-- the helper reads referees only through arbitri_asistent(), which does not return them.
alter table public.arbitri add column if not exists idnp text;
alter table public.arbitri add column if not exists nr_act text;
alter table public.arbitri add column if not exists data_emiterii_act date;
