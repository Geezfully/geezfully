-- Applied to setka-pontaj (ufkeqoeyrhwvvvtiopyt) on 2026-09-06.
--
-- Backups move to the central Backup project, so the daily Resend email is
-- removed. The in-database snapshot (backup_snapshots, rolling 3) is kept
-- deliberately: it is SETKA's only protection until the central pipeline is
-- wired and a first backup is verified. Once that happens, unschedule the job:
--
--   select cron.unschedule('daily-backup-email');
--
-- To restore the email instead, see ../ROLLBACK-send_daily_backup.sql.
-- No table, column or row is touched by this migration.
CREATE OR REPLACE FUNCTION public.send_daily_backup()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault'
AS $function$
declare
  full_backup jsonb;
begin
  -- Full snapshot, including fiscal_code/iban — stays inside Supabase.
  select jsonb_build_object(
    'generated_at', now(),
    'referees', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from referees r),
    'rate_categories', (select coalesce(jsonb_agg(to_jsonb(rc)), '[]'::jsonb) from rate_categories rc),
    'global_rates', (select coalesce(jsonb_agg(to_jsonb(gr)), '[]'::jsonb) from global_rates gr),
    'monthly_entries', (select coalesce(jsonb_agg(to_jsonb(me)), '[]'::jsonb) from monthly_entries me),
    'international_bonuses', (select coalesce(jsonb_agg(to_jsonb(ib)), '[]'::jsonb) from international_bonuses ib),
    'saved_acts', (select coalesce(jsonb_agg(to_jsonb(sa) - 'document_html'), '[]'::jsonb) from saved_acts sa)
  ) into full_backup;

  insert into backup_snapshots (data) values (full_backup);

  -- Retention: keep only the 3 most recent snapshots (today + previous 2).
  delete from backup_snapshots where id not in (
    select id from backup_snapshots order by created_at desc limit 3
  );
end;
$function$;
