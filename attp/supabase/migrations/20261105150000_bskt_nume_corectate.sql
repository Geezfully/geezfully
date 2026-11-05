-- Basketball player names as spelled in the passport register (registrul pașapoartelor,
-- received 05.11.2026). BSKT exports its own spelling every 15 minutes; sync_bskt now
-- writes the corrected name instead, so the register spelling survives every resync.
-- Keyed by the BSKT player id, so the link to games, totals and photos stays the same.
-- No foreign key on purpose: sync_bskt deletes and re-adds players, a correction must
-- outlive that. Only sync_bskt (security definer) reads it; visitors never need it.

create table if not exists public.bskt_nume_corectate (
  id uuid primary key,
  nume text not null,
  prenume text not null,
  sursa text not null default 'registrul pașapoartelor 05.11.2026',
  creat_la timestamptz not null default now()
);
alter table public.bskt_nume_corectate enable row level security;
revoke all on public.bskt_nume_corectate from anon, authenticated;
grant select, insert, update, delete on public.bskt_nume_corectate to service_role;

insert into public.bskt_nume_corectate (id, nume, prenume) values
  ('f22ae402-9253-4a87-a4c0-37f85ff81a0b', 'Andrianov', 'Alexei'),
  ('0016854f-59cd-4209-ad2c-36ecb51fc344', 'Arnaut', 'Vladimir'),
  ('4ecfa0a5-6641-4711-8247-6445fca08a14', 'Beloconi', 'Alexandr'),
  ('2dc5a3d6-9bd0-4a58-979a-37a10f0b3320', 'Bobu', 'Vladislav'),
  ('424b04ed-6c13-4274-a31e-a96f3a61f423', 'Buceațchi', 'Pavel'),
  ('a785646e-7513-46c8-ad77-048ad9a5cf18', 'Buza', 'Ivan'),
  ('db8595a9-6ef2-46c7-9074-ba81ee0823dc', 'Ceaicovschii', 'Alexandr'),
  ('7edb916f-c43e-4113-91d5-e9ff21606b00', 'Cebotari', 'Vladimir'),
  ('328c7ba2-0c7c-4cd2-88db-d7125318bf4d', 'Ciobanu', 'Constantin'),
  ('bf2c4b26-56a7-43da-ac63-837584e8d19c', 'Ciorba', 'Nichita'),
  ('9dc53a30-3243-430f-99f7-97b439041621', 'Cneazev', 'Vladimir'),
  ('a116e83e-275f-4edd-a44c-6e9d9a8c5073', 'Colun', 'Nicolae'),
  ('2b7ebc98-71ec-4397-a503-5bbcab948f10', 'Coșcodan', 'Serghei'),
  ('7e70c932-8e7d-4021-8373-76cb0e1cd011', 'Crivoi', 'Vadim'),
  ('f1c137a5-97ff-4cc5-a711-1817b30fc128', 'Cucereavîi', 'Ghenadie'),
  ('11b2d84a-9026-4f7b-abe6-d3b33b73b95f', 'Cuznețov', 'Dmitri'),
  ('c5838108-295a-40a5-b643-60c2ad027419', 'Cușniriuc', 'Nichita'),
  ('d4ff4a93-6d94-4499-b933-22bd30e5848b', 'Cușniriuc', 'Serghei'),
  ('8424f0c3-90f3-41fb-be17-bb1942c5b2a2', 'Dascal', 'Artiom'),
  ('9bf33499-5c1f-4c12-96c1-a64ed3db7324', 'Denisov', 'Anatolie'),
  ('a9d064c0-b1dd-4f44-acb4-c1120680f188', 'Dobrovolschi', 'Chiril'),
  ('e140a03c-8ec3-4fc1-98b1-5a54e7c54137', 'Dragomir', 'Maxim'),
  ('25760136-a10b-4ecd-aa43-c16bbef328bb', 'Dunai', 'Alexandru'),
  ('cfbf9a2f-6bc3-480f-802e-834be3929592', 'Epifanov', 'Serghei'),
  ('f5f83869-7bab-4268-9ea3-1c7014c937b7', 'Gheorghiev', 'Anatolie'),
  ('0330a9d1-7a52-4e31-82a1-e5b1f6b15e3c', 'Grubîi', 'Nicolae'),
  ('2f90723c-ffee-4e88-ba83-50346585e439', 'Gurin', 'Ivan'),
  ('654af173-d71c-4a37-b509-0ab393576b22', 'Himaci', 'Artiom'),
  ('f045e64c-ddde-425f-94b1-95bc7d2b9528', 'Iolchin', 'Alexandr'),
  ('5d484e19-4bd2-49fb-bec5-476535d36be7', 'Irimciuc', 'Egor'),
  ('2cab6d95-236f-432c-8801-b031d6d659bc', 'Kyshynskyi', 'Dmytro'),
  ('2f1653e6-674b-4eae-9d45-f8d0f0532f38', 'Lecari', 'Egor'),
  ('ccbd076d-b2e0-4136-9bd5-5dadb818b359', 'Malinovskiy', 'Dmitry'),
  ('a0637a33-903b-4bd8-a4ca-af0dd373f1fa', 'Melnic', 'Maxim'),
  ('7bf46f0d-112e-4775-a317-9222ef918a6e', 'Mikh', 'Vladyslav'),
  ('7f0d79dc-6b11-4369-be8f-96f5e855cb62', 'Monaf', 'Denis'),
  ('33e7bde4-f25e-4eb1-98b6-bce5a4e6e293', 'Monastîrschi', 'Vadim'),
  ('07a84685-1371-4d48-b3c7-78313d5e76ac', 'Muntean', 'Andrei'),
  ('e4750a40-5115-423c-9699-ff5d0fb24382', 'Mușuc', 'Grigori'),
  ('6e6489bd-09f7-44c4-b90a-81766a6a88e7', 'Pisariuc', 'Roman'),
  ('fe0f432f-3f12-4689-8eb5-662742cbefac', 'Plamadeala', 'Anatolie'),
  ('9c087864-ed06-4d3b-81e6-37f84ba13036', 'Platon', 'Evgheni'),
  ('5c14e805-02e3-4f87-846d-baf3a72e7bd3', 'Popov', 'Igor'),
  ('f4f9ac14-c9b8-43d4-a690-48a071c3f1fe', 'Pravdiuk', 'Oleg'),
  ('e34179a0-41da-4b80-9ddb-e9c2e2db74e0', 'Procopciuc', 'Mihai'),
  ('fd885bd7-2e1c-4783-84d4-a3c9c11764b6', 'Pruglo', 'Alexandr'),
  ('2a216830-d0c0-4fdb-aa36-6523ff63513e', 'Puiu', 'Vladislav'),
  ('84b799fd-680d-463e-8c1e-2e09b6e97ff2', 'Radulov', 'Vadim'),
  ('2839d44a-eea4-46cf-9876-3c20a63104df', 'Railean', 'Adrian'),
  ('20c1d35f-2f69-4436-80e2-91b85f89325b', 'Rusu', 'Andrei'),
  ('46475ffc-50c0-4574-a340-e3ce2549818a', 'Răducan', 'Vadim'),
  ('8d74c9ae-b57a-4c89-a88c-1ba62736d984', 'Savca', 'Denis'),
  ('6ff5af9b-971d-4e03-8a6e-8b44077cba7e', 'Scorupeev', 'Ivan'),
  ('b26a0a3f-3859-45b6-9a13-f06477a68d88', 'Serț', 'Alexandr'),
  ('3d4a8ea4-ec2d-41b8-8308-2da659ffdb5d', 'Slavioglo', 'Piotr'),
  ('7f88d5d1-5daa-4922-abae-a84f4598de72', 'Sturza', 'Iuvenalie'),
  ('9980c44b-c101-432c-9abb-268c41a8f552', 'Sveclă', 'Adrian'),
  ('3d8d8d76-ca3c-40f2-af7f-0246001c448b', 'Tarlev', 'Tudor'),
  ('c66d6b73-a222-4f91-a2db-27be7de2cd77', 'Tcaciov', 'Dmitrii'),
  ('57030727-5b09-4594-a04d-5fea21fac974', 'Volchanov', 'Mykhailo'),
  ('81f39502-f834-46a9-960d-46b7b47815cb', 'Volcovschii', 'Alexandru'),
  ('320e2e60-05c0-44db-91aa-5cd2edeb3772', 'Ștubei', 'Alexandr'),
  ('52af7c80-fa66-45f8-8b4a-7e089be21b5e', 'Țurcan', 'Denis'),
  ('0977f842-83b9-46d7-976d-a9bedfb4895d', 'Țîbrigan', 'Pavel')
on conflict (id) do update set nume = excluded.nume, prenume = excluded.prenume, sursa = excluded.sursa;

-- apply now, without waiting for the next sync
update public.bskt_jucatori j set nume = c.nume, prenume = c.prenume
  from public.bskt_nume_corectate c
 where c.id = j.id and (j.nume, j.prenume) is distinct from (c.nume, c.prenume);

-- sync_bskt: the player upsert takes the corrected name when there is one.
-- Only that statement changes; the rest of the function (20261104120000) stays as it is.
do $mig$
declare
  d text := pg_get_functiondef('public.sync_bskt'::regproc);
  old_sql text := $o$  select (x->>'id')::uuid, x->>'nume', x->>'prenume', (x->>'varsta')::int,
         (x->>'meciuri')::int, (x->>'victorii')::int, (x->>'infrangeri')::int, now()
    from jsonb_array_elements(src) x
  on conflict (id)$o$;
  new_sql text := $n$  select (x->>'id')::uuid, coalesce(c.nume, x->>'nume'), coalesce(c.prenume, x->>'prenume'), (x->>'varsta')::int,
         (x->>'meciuri')::int, (x->>'victorii')::int, (x->>'infrangeri')::int, now()
    from jsonb_array_elements(src) x
    left join bskt_nume_corectate c on c.id = (x->>'id')::uuid  -- register spelling wins (20261105150000)
  on conflict (id)$n$;
begin
  if position(old_sql in d) = 0 then
    raise exception 'sync_bskt changed: player upsert not found, apply the name correction by hand';
  end if;
  execute replace(d, old_sql, new_sql);
end
$mig$;
