-- Referee pay: record when each referee worked (start/end can cross midnight).
-- Pay rule (computed in the app from app_config 'tarif_arbitri'):
--   one referee that day   -> fixed day rate (1000 lei, full 8 h day)
--   two referees that day  -> each: hours worked x hourly rate (80 lei/h; 8 h = 640)
alter table public.arbitraj
  add column if not exists ora_start time,
  add column if not exists ora_stop time;

insert into public.app_config(key, value)
values ('tarif_arbitri', '{"zi":1000,"ora":80,"oreZi":8}')
on conflict (key) do nothing;
