-- Original definition of public.send_daily_backup(), captured 2026-09-06 before
-- the daily backup email was removed. Restores the emailing behaviour exactly
-- as it ran for its 52 successful cron executions.
CREATE OR REPLACE FUNCTION public.send_daily_backup()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault'
AS $function$
declare
  full_backup jsonb;
  redacted_backup jsonb;
  backup_b64 text;
  api_key text;
  today_label text;
  file_label text;
  ref_count int;
  entry_count int;
  kept_count int;
begin
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key';
  if api_key is null then
    raise exception 'resend_api_key not found in vault';
  end if;

  -- Full snapshot, including fiscal_code/iban — stays inside Supabase, never emailed.
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
  select count(*) into kept_count from backup_snapshots;

  -- Redacted copy for email — strips fiscal_code/iban before it ever leaves Supabase.
  select jsonb_build_object(
    'generated_at', full_backup->'generated_at',
    'referees', (select coalesce(jsonb_agg(to_jsonb(r) - 'fiscal_code' - 'iban'), '[]'::jsonb) from referees r),
    'rate_categories', full_backup->'rate_categories',
    'global_rates', full_backup->'global_rates',
    'monthly_entries', full_backup->'monthly_entries',
    'international_bonuses', full_backup->'international_bonuses',
    'saved_acts', full_backup->'saved_acts'
  ) into redacted_backup;

  select count(*) into ref_count from referees;
  select count(*) into entry_count from monthly_entries;

  backup_b64 := encode(convert_to(redacted_backup::text, 'UTF8'), 'base64');
  today_label := to_char(now(), 'DD.MM.YYYY');
  file_label := 'backup-setka-pro-' || to_char(now(), 'YYYY-MM-DD') || '.json';

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'Pontaj SETKA-PRO <onboarding@resend.dev>',
      'to', jsonb_build_array('berlibaflorentiu@gmail.com'),
      'subject', 'Backup zilnic Pontaj SETKA-PRO — ' || today_label,
      'html', '<div style="font-family:sans-serif;color:#111"><h2 style="margin:0 0 8px">Backup zilnic — ' || today_label || '</h2>' ||
              '<p style="color:#444">' || ref_count || ' participanți, ' || entry_count || ' înregistrări lunare active.</p>' ||
              '<p style="color:#444">Copia completă (inclusiv codurile fiscale și IBAN-urile) e păstrată în siguranță în baza de date Supabase — ultimele ' || kept_count || ' zile. Fișierul atașat aici conține aceleași date, <strong>fără codurile fiscale și IBAN-urile</strong>, ca măsură suplimentară de precauție pentru email.</p>' ||
              '<p style="color:#999;font-size:12px">Generat automat de aplicația Pontaj SETKA-PRO.</p></div>',
      'attachments', jsonb_build_array(
        jsonb_build_object('filename', file_label, 'content', backup_b64)
      )
    )
  );
end;
$function$;
