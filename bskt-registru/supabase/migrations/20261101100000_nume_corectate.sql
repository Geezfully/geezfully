-- Name corrections sent by the user on the marked Plăți Excel, so acts and other documents print them correctly.
-- Only the display name changes: the player keeps the same row, games, pay, contract and links to the sheet
-- (the sheet's spellings stay in tabel_jucatori). Old names: backup schema.

create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;
create table if not exists backup.nume_participanti_20261101 as
  select id, nume, prenume, nr_contract from public.participanti
  where nr_contract in ('107-10','118-10','120-10','121-10','130-10','139-10');

do $$
declare n int;
begin
  update public.participanti p set nume = v.nume_nou, prenume = v.prenume_nou
  from (values
    ('107-10', 'Cușneriuc',    'Serghei',  'Cușniriuc',   'Serghei'),
    ('118-10', 'Monastirschi', 'Vadim',    'Monastîrschi','Vadim'),
    ('120-10', 'Cusniriuc',    'Nichita',  'Cușniriuc',   'Nichita'),
    ('121-10', 'Cucereavii',   'Ghenadii', 'Cucereavîi',  'Ghenadie'),
    ('130-10', 'Buceatchi',    'Pavel',    'Buceațchi',   'Pavel'),
    ('139-10', 'Buruiana',     'Sergiu',   'Buruiană',    'Sergiu')
  ) v(nr_contract, nume_vechi, prenume_vechi, nume_nou, prenume_nou)
  where p.nr_contract = v.nr_contract and p.nume = v.nume_vechi and p.prenume = v.prenume_vechi;
  get diagnostics n = row_count;
  if n <> 6 then raise exception 'expected 6 names to change, got %', n; end if;
end $$;

insert into public.jurnal (administrator_id, actiune) values (null,
  'Nume corectate din Excelul de plăți: Cușniriuc Serghei, Monastîrschi Vadim, Cușniriuc Nichita, Cucereavîi Ghenadie, Buceațchi Pavel, Buruiană Sergiu. Jucătorii, meciurile, plățile, contractele și legăturile cu tabelul rămân aceleași.');
