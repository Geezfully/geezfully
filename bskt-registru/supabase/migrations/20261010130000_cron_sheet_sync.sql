-- Automatic sync with the owners' Google Sheet every 10 minutes (minutes 2, 12, 22, …), offset from the website
-- fallback (results-sync at :00/:15/:30/:45) so the two never run in the same minute.
select cron.schedule('bskt-sheet-sync', '2-59/10 * * * *', $$
  select net.http_post(
    url := 'https://sbkobwcuywnnmjsbrzqi.supabase.co/functions/v1/sheet-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$$);
