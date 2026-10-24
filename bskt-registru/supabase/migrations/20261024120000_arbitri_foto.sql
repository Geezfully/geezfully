-- Referee photo, same private bucket 'fotografii' as players (<arbitru_id>/<timestamp>.jpg)
alter table public.arbitri add column if not exists foto_path text;
