-- Results feed from https://3x3.bsktcup.com (Webflow site, no API — the results-sync edge function scrapes the HTML).
-- Only the teams in our registry are tracked: a site match is imported only when BOTH teams are linked here.
-- Imported matches have no roster, so they move team stats only; pay starts once players are added to a match.

-- 1. link our teams to the site's team pages; logo + its main colour drive the team card
alter table public.echipe
  add column if not exists slug_extern text unique,
  add column if not exists logo_url text;

update public.echipe e set slug_extern = v.slug, logo_url = v.logo, culoare = v.culoare
from (values
  ('District Kings', 'district-kings',   'https://cdn.prod.website-files.com/6aac35930b4576c7ef33dd53/6ab426c973aa77feee11accb_District%20Kings.svg',   '#5971fc'),
  ('HC Bulls',       'half-court-bulls', 'https://cdn.prod.website-files.com/6aac35930b4576c7ef33dd53/6ab426e9817930f3f65b39f9_Half%20Court%20Bulls.svg', '#ff1a41'),
  ('Hoopers',        'hoopers',          'https://cdn.prod.website-files.com/6aac35930b4576c7ef33dd53/6ab4272160d262e985d598fb_hoopers.svg',            '#3333ff'),
  ('Hunters',        'hunters',          'https://cdn.prod.website-files.com/6aac35930b4576c7ef33dd53/6ab42737cb02192d58a0b1b2_hunters.svg',            '#ff001f'),
  ('Inner Circle',   'inner-circle',     'https://cdn.prod.website-files.com/6aac35930b4576c7ef33dd53/6ab4279f049352c0594e4abc_Inner%20Circle.svg',     '#def48a'),
  ('Metropolitans',  'metropolitans',    'https://cdn.prod.website-files.com/6aac35930b4576c7ef33dd53/6ab427cef2bc81083cd8216a_Metropolitans.svg',      '#ef5a20'),
  ('Neon Basket',    'neon-basket',      'https://cdn.prod.website-files.com/6aac35930b4576c7ef33dd53/6ab429756439c646792a20de_neon-basket.png',        '#88e551'),
  ('Orbit Basket',   'orbit-basket',     'https://cdn.prod.website-files.com/6aac35930b4576c7ef33dd53/6ab429b5ab794c482e68263a_Orbit%20Basket.svg',     '#f7931e'),
  ('Runners',        'rim-runners',      'https://cdn.prod.website-files.com/6aac35930b4576c7ef33dd53/6ab429c9ed6f77cf39bb30ef_Rim%20Runners.svg',      '#09703f'),
  ('Tempo',          'team-tempo',       'https://cdn.prod.website-files.com/6aac35930b4576c7ef33dd53/6ab429e425716c131e7a0fc7_Team%20Tempo.svg',       '#bc996b'),
  ('Westsiders',     'westsiders',       'https://cdn.prod.website-files.com/6aac35930b4576c7ef33dd53/6ab42a440feb29d4f3de47df_westsiders.svg',         '#e2dfdc')
) as v(nume, slug, logo, culoare)
where e.nume = v.nume;

-- 2. where a match came from; id_extern = "<site date>T<HH:MM>|<slug A>|<slug B>" (stable across runs)
alter table public.meciuri
  add column if not exists sursa text not null default 'manual' check (sursa in ('manual','bsktcup')),
  add column if not exists id_extern text unique,
  add column if not exists sincronizat_la timestamptz;

-- 3. one row per sync run (the app shows the last one on Meciuri)
create table if not exists public.sync_rezultate (
  id bigint generated always as identity primary key,
  rulat_la timestamptz not null default now(),
  complet boolean not null default false,       -- true = every archive month was crawled
  ok boolean not null,
  pagini int not null default 0,
  gasite int not null default 0,                -- matches parsed on the site
  inserate int not null default 0,
  actualizate int not null default 0,
  sterse int not null default 0,                -- rescheduled/cancelled fixtures removed
  ignorate int not null default 0,              -- at least one team not in our registry
  eroare text,
  detalii jsonb
);
create index if not exists sync_rezultate_rulat_idx on public.sync_rezultate(rulat_la desc);
alter table public.sync_rezultate enable row level security;
create policy "sync_rezultate: citire" on public.sync_rezultate for select to authenticated using ((select public.is_administrator()));

-- keep 30 days of run history
create or replace function public.curata_sync_rezultate() returns void language sql security definer set search_path=public as $$
  delete from public.sync_rezultate where rulat_la < now() - interval '30 days';
$$;
revoke execute on function public.curata_sync_rezultate() from public, anon, authenticated;

-- 4. schedule (UTC). Game hours 18:00–03:00 Chișinău = 15:00–00:59 UTC in summer, 16:00–01:59 in winter:
--    every 15 min across both windows; hourly the rest of the day; full archive crawl at 05:00.
select cron.schedule('bskt-results-sync', '*/15 15-23,0,1 * * *', $job$
  select net.http_post(
    url := 'https://sbkobwcuywnnmjsbrzqi.supabase.co/functions/v1/results-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);
select cron.schedule('bskt-results-sync-offhours', '0 2-14 * * *', $job$
  select net.http_post(
    url := 'https://sbkobwcuywnnmjsbrzqi.supabase.co/functions/v1/results-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);
select cron.schedule('bskt-results-sync-full', '0 5 * * *', $job$
  select net.http_post(
    url := 'https://sbkobwcuywnnmjsbrzqi.supabase.co/functions/v1/results-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{"full":true}'::jsonb,
    timeout_milliseconds := 120000);
  select public.curata_sync_rezultate();
$job$);
