-- Applied to setka-pontaj (ufkeqoeyrhwvvvtiopyt) on 2026-10-01.
--
-- One-off: August 2026 charges were never deducted, so ATTP charges dated
-- 1-27 Aug (August's own business period, locked) are filed under September
-- 2026 and deducted there. 28-31 Aug already belonged to September. Every
-- other date keeps business_period(). Needs ATTP's feed floor at 2026-08-01
-- (attp-pontaj migration 202610010001).
--
-- The live function definitions are edited in place; each edit aborts unless
-- its target appears exactly once. Once September is locked the rule is inert.
--
-- Verified against safety snapshot 07:33 UTC: September Spălătorie 0 -> 708,
-- Daune 800 -> 1600, Antrenamente 700 -> 2100 (+2908, 12 players); Uzun +500
-- (29.08 not counted twice); no other field, row or month changed; a second
-- sync changed nothing.
create or replace function public.attp_charge_period(p_data date)
returns date language sql immutable set search_path = public, pg_temp as $b$
  select case when p_data >= date '2026-08-01' and p_data < date '2026-08-28' then date '2026-09-01'
              else business_period(p_data) end;
$b$;
revoke all on function public.attp_charge_period(date) from public, anon, authenticated;

do $$
declare
  v_apply text := pg_get_functiondef('public.attp_sync_apply(jsonb,date)'::regprocedure);
  v_pull text := pg_get_functiondef('public.attp_sync_pull()'::regprocedure);
  a1 text := 'business_period((r->>''data'')::date) period';
  p1 text := 'c_start constant date := date ''2026-08-28''';
  p2 text := 'business_period(days.d)';
begin
  if (length(v_apply) - length(replace(v_apply, a1, ''))) / length(a1) <> 1 then raise exception 'apply target not found exactly once'; end if;
  if (length(v_pull) - length(replace(v_pull, p1, ''))) / length(p1) <> 1 then raise exception 'pull start not found exactly once'; end if;
  if (length(v_pull) - length(replace(v_pull, p2, ''))) / length(p2) <> 1 then raise exception 'pull period not found exactly once'; end if;
  execute replace(v_apply, a1, 'attp_charge_period((r->>''data'')::date) period');
  execute replace(replace(v_pull, p1, 'c_start constant date := date ''2026-08-01'''), p2, 'attp_charge_period(days.d)');
end;
$$;

revoke all on function public.attp_sync_apply(jsonb, date) from public, anon, authenticated;
revoke all on function public.attp_sync_pull() from public, anon, authenticated;
