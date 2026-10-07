-- Nightly backup: cron secret generated inside the DB and read from Vault at call time (never hardcoded).
-- The daily-backup function also needs Vault secrets 'resend_api_key' and 'backup_email' to actually send.
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'cron_secret', 'x-cron-secret for daily-backup');
select cron.schedule('bskt-daily-backup', '0 20 * * *', $job$
  select net.http_post(
    url := 'https://sbkobwcuywnnmjsbrzqi.supabase.co/functions/v1/daily-backup',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);

-- Trigger functions are never callable over REST.
revoke execute on function public.ajusteaza_stoc_arbitraj_update(), public.calculeaza_plata_meci_jucator(),
  public.credit_stoc_uzat_lenjerie(), public.credit_stoc_uzat_vestimentatie(), public.deduce_stoc_arbitraj(),
  public.deduce_stoc_lenjerie(), public.deduce_stoc_vestimentatie(), public.inregistreaza_schimb_finalizat_in_serviciu(),
  public.prevent_lenjerie_revert(), public.prevent_vestimentatie_revert(), public.recalculeaza_plati_la_schimbare_meci(),
  public.atribuie_angajat_jurnal_din_schimb()
  from public, anon, authenticated;
-- New functions start closed; grant explicitly.
alter default privileges in schema public revoke execute on functions from authenticated;
