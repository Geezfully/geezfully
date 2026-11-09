-- Where the basketball players are from, for the homepage map and the "Localități" count.
-- The BSKT register has no town field, only a free-text home address (never sent here).
-- The town was read from each address once (09.11.2026): spelled-out town names, typos
-- included; addresses that give only a street that is in Chișinău; and, where the street
-- exists in several towns, the place of birth decided it. 75 of 83 players placed; the 8
-- without any address stay out of the town count until a town is added here.
-- Keyed by the BSKT player id with no foreign key, like bskt_nume_corectate, so a town
-- outlives sync_bskt deleting and re-adding a player. Visitors never read this table:
-- they get per-town totals from bskt_localitati_stat(), so no single player's town is public.

create table if not exists public.bskt_localitati (
  id uuid primary key,
  localitate text not null,
  sursa text not null,
  creat_la timestamptz not null default now()
);
alter table public.bskt_localitati enable row level security;
revoke all on public.bskt_localitati from anon, authenticated;
grant select, insert, update, delete on public.bskt_localitati to service_role;

create or replace function public.bskt_localitati_stat()
returns table (localitate text, jucatori int)
language sql stable security definer set search_path = public
as $$
  select l.localitate, count(*)::int
    from public.bskt_localitati l
    join public.bskt_jucatori j on j.id = l.id
   group by l.localitate
   order by 2 desc, 1;
$$;
revoke all on function public.bskt_localitati_stat() from public;
grant execute on function public.bskt_localitati_stat() to anon, authenticated, service_role;

insert into public.bskt_localitati (id, localitate, sursa) values
  ('0977f842-83b9-46d7-976d-a9bedfb4895d', 'Chișinău', 'adresă'),
  ('9980c44b-c101-432c-9abb-268c41a8f552', 'Chișinău', 'adresă'),
  ('f5f83869-7bab-4268-9ea3-1c7014c937b7', 'Chișinău', 'adresă'),
  ('2f1653e6-674b-4eae-9d45-f8d0f0532f38', 'Chișinău', 'adresă'),
  ('936f54d3-885a-45ce-ae1f-5b6459f3456f', 'Chișinău', 'adresă'),
  ('0330a9d1-7a52-4e31-82a1-e5b1f6b15e3c', 'Chișinău', 'adresă'),
  ('33e7bde4-f25e-4eb1-98b6-bce5a4e6e293', 'Chișinău', 'adresă'),
  ('7f0d79dc-6b11-4369-be8f-96f5e855cb62', 'Chișinău', 'adresă'),
  ('fd885bd7-2e1c-4783-84d4-a3c9c11764b6', 'Chișinău', 'adresă'),
  ('f22ae402-9253-4a87-a4c0-37f85ff81a0b', 'Chișinău', 'adresă'),
  ('57030727-5b09-4594-a04d-5fea21fac974', 'Chișinău', 'adresă'),
  ('b26a0a3f-3859-45b6-9a13-f06477a68d88', 'Chișinău', 'adresă'),
  ('11b2d84a-9026-4f7b-abe6-d3b33b73b95f', 'Chișinău', 'adresă'),
  ('c66d6b73-a222-4f91-a2db-27be7de2cd77', 'Chișinău', 'adresă'),
  ('424b04ed-6c13-4274-a31e-a96f3a61f423', 'Chișinău', 'adresă'),
  ('6ff5af9b-971d-4e03-8a6e-8b44077cba7e', 'Chișinău', 'adresă'),
  ('5d484e19-4bd2-49fb-bec5-476535d36be7', 'Chișinău', 'adresă'),
  ('a9d064c0-b1dd-4f44-acb4-c1120680f188', 'Chișinău', 'adresă'),
  ('20c1d35f-2f69-4436-80e2-91b85f89325b', 'Chișinău', 'adresă'),
  ('654af173-d71c-4a37-b509-0ab393576b22', 'Chișinău', 'adresă'),
  ('6648df56-36e3-4bab-b08b-95bb3751408f', 'Chișinău', 'adresă'),
  ('a0d87627-5151-40ee-91a7-5cfca4f1654d', 'Chișinău', 'adresă'),
  ('e34179a0-41da-4b80-9ddb-e9c2e2db74e0', 'Chișinău', 'adresă'),
  ('f4f9ac14-c9b8-43d4-a690-48a071c3f1fe', 'Chișinău', 'adresă'),
  ('a116e83e-275f-4edd-a44c-6e9d9a8c5073', 'Chișinău', 'adresă'),
  ('2f90723c-ffee-4e88-ba83-50346585e439', 'Chișinău', 'adresă'),
  ('0016854f-59cd-4209-ad2c-36ecb51fc344', 'Chișinău', 'adresă'),
  ('a785646e-7513-46c8-ad77-048ad9a5cf18', 'Chișinău', 'adresă'),
  ('7e70c932-8e7d-4021-8373-76cb0e1cd011', 'Chișinău', 'adresă'),
  ('a0637a33-903b-4bd8-a4ca-af0dd373f1fa', 'Chișinău', 'adresă'),
  ('7bf46f0d-112e-4775-a317-9222ef918a6e', 'Chișinău', 'adresă'),
  ('e4750a40-5115-423c-9699-ff5d0fb24382', 'Chișinău', 'adresă'),
  ('f045e64c-ddde-425f-94b1-95bc7d2b9528', 'Chișinău', 'adresă'),
  ('839fb1f8-9617-4e5d-b597-f78a66aa231e', 'Chișinău', 'adresă'),
  ('de4d596f-8e3a-4723-b600-c84cb4983a93', 'Chișinău', 'adresă'),
  ('52af7c80-fa66-45f8-8b4a-7e089be21b5e', 'Chișinău', 'stradă din Chișinău'),
  ('c5838108-295a-40a5-b643-60c2ad027419', 'Chișinău', 'stradă din Chișinău'),
  ('bf2c4b26-56a7-43da-ac63-837584e8d19c', 'Chișinău', 'stradă din Chișinău'),
  ('2a216830-d0c0-4fdb-aa36-6523ff63513e', 'Chișinău', 'stradă din Chișinău'),
  ('328c7ba2-0c7c-4cd2-88db-d7125318bf4d', 'Chișinău', 'stradă din Chișinău'),
  ('6e6489bd-09f7-44c4-b90a-81766a6a88e7', 'Chișinău', 'stradă din Chișinău'),
  ('46475ffc-50c0-4574-a340-e3ce2549818a', 'Chișinău', 'stradă din Chișinău'),
  ('d056a837-5951-4502-bbd8-2ee89214129a', 'Chișinău', 'stradă din Chișinău'),
  ('ec1000e5-2db4-4eda-bc69-1e51a4314ae4', 'Chișinău', 'stradă din Chișinău'),
  ('320e2e60-05c0-44db-91aa-5cd2edeb3772', 'Chișinău', 'stradă din Chișinău'),
  ('25760136-a10b-4ecd-aa43-c16bbef328bb', 'Chișinău', 'stradă din Chișinău'),
  ('5c14e805-02e3-4f87-846d-baf3a72e7bd3', 'Chișinău', 'stradă din Chișinău'),
  ('d4ff4a93-6d94-4499-b933-22bd30e5848b', 'Chișinău', 'stradă din Chișinău'),
  ('3d8d8d76-ca3c-40f2-af7f-0246001c448b', 'Chișinău', 'stradă din Chișinău'),
  ('8424f0c3-90f3-41fb-be17-bb1942c5b2a2', 'Chișinău', 'stradă din Chișinău'),
  ('47f5abd8-59d5-477c-9d27-d99a7da4d978', 'Chișinău', 'stradă din Chișinău'),
  ('9e62aee1-c321-4f02-8d5d-cfbb417ce7e3', 'Chișinău', 'stradă din Chișinău'),
  ('db8595a9-6ef2-46c7-9074-ba81ee0823dc', 'Chișinău', 'stradă din Chișinău'),
  ('ccbd076d-b2e0-4136-9bd5-5dadb818b359', 'Chișinău', 'stradă din Chișinău'),
  ('f1c137a5-97ff-4cc5-a711-1817b30fc128', 'Chișinău', 'stradă din Chișinău'),
  ('2cab6d95-236f-432c-8801-b031d6d659bc', 'Chișinău', 'stradă din Chișinău'),
  ('f6533658-d8e5-4819-9c19-03b4e7650f78', 'Chișinău', 'stradă din Chișinău'),
  ('9c087864-ed06-4d3b-81e6-37f84ba13036', 'Chișinău', 'stradă din Chișinău'),
  ('1a3c773f-550a-4afd-94ce-3a0fdf0e33d4', 'Chișinău', 'stradă din Chișinău'),
  ('fe0f432f-3f12-4689-8eb5-662742cbefac', 'Chișinău', 'stradă din Chișinău'),
  ('edf3c4a5-87a3-4541-9be5-18ec1a0fe2ff', 'Chișinău', 'stradă din Chișinău'),
  ('2dc5a3d6-9bd0-4a58-979a-37a10f0b3320', 'Chișinău', 'stradă din Chișinău'),
  ('5f8beef1-b51d-4f38-902d-004a86a7baa3', 'Bălți', 'adresă'),
  ('4ecfa0a5-6641-4711-8247-6445fca08a14', 'Basarabeasca', 'adresă'),
  ('9dc53a30-3243-430f-99f7-97b439041621', 'Basarabeasca', 'stradă + loc naștere'),
  ('7edb916f-c43e-4113-91d5-e9ff21606b00', 'Ceadîr-Lunga', 'adresă'),
  ('84b799fd-680d-463e-8c1e-2e09b6e97ff2', 'Ceadîr-Lunga', 'adresă'),
  ('7f88d5d1-5daa-4922-abae-a84f4598de72', 'Dondușeni', 'adresă'),
  ('2839d44a-eea4-46cf-9876-3c20a63104df', 'Durlești', 'adresă'),
  ('8d74c9ae-b57a-4c89-a88c-1ba62736d984', 'Glodeni', 'adresă'),
  ('81f39502-f834-46a9-960d-46b7b47815cb', 'Ialoveni', 'adresă'),
  ('9bf33499-5c1f-4c12-96c1-a64ed3db7324', 'Orhei', 'adresă'),
  ('cfbf9a2f-6bc3-480f-802e-834be3929592', 'Bender', 'stradă + loc naștere'),
  ('3d4a8ea4-ec2d-41b8-8308-2da659ffdb5d', 'Beșghioz', 'adresă'),
  ('07a84685-1371-4d48-b3c7-78313d5e76ac', 'Ferapontievca', 'adresă')
on conflict (id) do update set localitate = excluded.localitate, sursa = excluded.sursa;
