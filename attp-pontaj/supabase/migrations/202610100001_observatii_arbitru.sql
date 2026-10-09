-- Observații can be about a referee: referees are not participants, so until
-- now they were typed by hand as a "situație generală" ("Судья Маренко Арсений").
-- Same model as intarzieri / vestimentatie: the referee is stored by name in
-- `arbitru`, and an observation targets exactly one of participant, referee
-- or general subject. Rows written by the previous version of the app
-- (participant or subject) stay valid. The new "Arbitraj" category needs no
-- change here: categorie is free text.
begin;

alter table public.observatii add column if not exists arbitru text;

alter table public.observatii drop constraint if exists observatii_tinta_valida_check;
alter table public.observatii add constraint observatii_tinta_valida_check check (
  (participant_id is not null)::integer
  + (nullif(btrim(arbitru), '') is not null)::integer
  + (nullif(btrim(subiect), '') is not null)::integer = 1
);

commit;
