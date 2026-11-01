-- Referees: 750 lei gross per tournament of 8 games = 93.75 gross per hour. The app stores the net rate and adds the
-- withholding on top, so 79.6875 net at 15% gives exactly 93.75 gross. It has no start date: nothing was recorded in
-- arbitraj before this, so no past amount changes.
-- ore_total lets a whole month's hours go in one entry; start/end times can't span more than a day.

alter table public.arbitraj add column if not exists ore_total numeric(7,2) check (ore_total >= 0);
comment on column public.arbitraj.ore_total is 'Hours typed as a total (e.g. a month), used instead of ora_start / ora_stop';

update public.app_config set value = '{"ora":79.6875,"retinerePct":15}', updated_at = now() where key = 'tarif_arbitri';

insert into public.jurnal (administrator_id, actiune) values (null,
  'Tariful arbitrilor: 93,75 lei brut pe oră (79,6875 net, reținere 15%), în loc de 80 net (94,12 brut). Orele se pot introduce și ca total, într-o singură înregistrare.');
