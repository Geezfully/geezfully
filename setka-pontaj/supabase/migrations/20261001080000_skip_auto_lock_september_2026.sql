-- Applied to setka-pontaj (ufkeqoeyrhwvvvtiopyt) on 2026-10-01.
--
-- September 2026 is locked by hand later (August deductions and month-end
-- adjustments still being made), so the 1 Oct 12:00 Moldova job
-- (category-reclass-monthly, 09:00 UTC) must not lock it. Only the
-- auto_lock call is skipped, and only for 2026-09-01; the Setka stats capture
-- and the category proposals still run. From October on the job locks as
-- before. Live definition edited in place; aborts unless the target line
-- appears exactly once.
do $$
declare
  v_def text := pg_get_functiondef('public.category_reclass_cron_tick()'::regprocedure);
  v_old text := '    perform public.auto_lock_period(t.close_period);';
  v_new text := '    if t.close_period <> date ''2026-09-01'' then  -- September 2026: locked by hand
      perform public.auto_lock_period(t.close_period);
    end if;';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'auto_lock line not found exactly once';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;
