-- Applied to ATTP Pontaj (ildoegipvcgxboijfksw) on 2026-10-01.
--
-- Lowers the SETKA feed's start date from 28 Aug to 1 Aug 2026, so the whole
-- of August (not deducted at the time) can be deducted in September. Nothing
-- else in setka_deduceri changes: the live definition is edited in place and
-- the change aborts unless exactly the two expected occurrences are found.
--
-- On its own this changes nothing in SETKA: its pull still asks from 28 Aug,
-- and 1-27 Aug would fall in the locked August period anyway. The SETKA side
-- needs its own one-off change to file 1-27 Aug charges under September.
do $$
declare
  v_old text := pg_get_functiondef('public.setka_deduceri(date)'::regprocedure);
  v_new text;
  v_hits int;
begin
  v_hits := (length(v_old) - length(replace(v_old, 'date ''2026-08-28''', ''))) / length('date ''2026-08-28''');
  if v_hits <> 2 then
    raise exception 'expected 2 occurrences of the old floor, found %', v_hits;
  end if;
  v_new := replace(v_old, 'date ''2026-08-28''', 'date ''2026-08-01''');
  execute v_new;
end;
$$;
