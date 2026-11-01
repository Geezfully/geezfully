-- More pitches for referees and cards, and room for one referee per pitch on each shift.
--
-- The dropdowns now offer eight pitches (TOURNAMENTS in index.html). RIO, MEXICO Day and
-- MEXICO Night stay allowed: existing rows keep their text, and a tab still on the previous
-- build can keep saving during the release. Only the checks change; no row is rewritten.
begin;

alter table public.arbitraj
  drop constraint arbitraj_turneu_check,
  add constraint arbitraj_turneu_check check (turneu in (
    'RIO','MEXICO Day','MEXICO Night',
    'Rio','Mexico','Rio Day2','Mexico Day2','Mexico Evening','Mexico Night','Rio Evening','Rio Night')),
  drop constraint arbitraj_slot_schimb_check,
  add constraint arbitraj_slot_schimb_check check (slot_schimb between 1 and 8);

alter table public.fair_play
  drop constraint fair_play_platou_check,
  add constraint fair_play_platou_check check (platou in (
    'RIO','MEXICO Day','MEXICO Night',
    'Rio','Mexico','Rio Day2','Mexico Day2','Mexico Evening','Mexico Night','Rio Evening','Rio Night'));

commit;
