-- Rolling lock: the current week and last week stay open; every older week with games is locked automatically.
-- Each week is auto-locked only once (remembered in saptamani_auto_blocate), so an admin who unlocks an old week
-- to fix something is not overruled by the next run.

create table if not exists public.saptamani_auto_blocate (
  luni date primary key,
  blocat_la timestamptz not null default now()
);
alter table public.saptamani_auto_blocate enable row level security;

create or replace function public.blocheaza_saptamani_vechi()
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_prag date := date_trunc('week', (now() at time zone 'Europe/Chisinau')::date)::date - 7;  -- Monday of last week
  v_luni date;
  v_n int := 0;
begin
  for v_luni in
    select distinct date_trunc('week', m.data)::date
    from public.meciuri m
    where m.data < v_prag
      and date_trunc('week', m.data)::date not in (select luni from public.saptamani_auto_blocate)
    order by 1
  loop
    insert into public.saptamani_blocate (luni, blocat_de) values (v_luni, null) on conflict (luni) do nothing;
    insert into public.saptamani_auto_blocate (luni) values (v_luni);
    insert into public.jurnal (administrator_id, actiune)
    values (null, 'Blocare automată: săptămâna ' || to_char(v_luni, 'DD.MM') || '–' || to_char(v_luni + 6, 'DD.MM.YYYY'));
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;

revoke all on function public.blocheaza_saptamani_vechi() from public, anon, authenticated;

select cron.schedule('bskt-blocare-saptamani', '5 * * * *', $$select public.blocheaza_saptamani_vechi()$$);

select public.blocheaza_saptamani_vechi();
