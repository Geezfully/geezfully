-- Rates from "ANEXA nr. 1 la Contractul de prestări servicii sportive" (2026), valid for every game from 01.09.2026.
-- Net amounts chosen so the gross (net ÷ 0.85) is a whole number: captain 217 / 159, player and reserve 182 / 123.
-- Replaces the 06.10 rates, and every pay row since 01.09 is recalculated — locked weeks included (the user asked for
-- the whole period); the lock check is switched off only inside this transaction. Old amounts: backup schema.

create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;
create table if not exists backup.tarife_plata_20261026 as select * from public.tarife_plata;
create table if not exists backup.plati_meci_20261026 as
  select mj.id, mj.meci_id, mj.participant_id, mj.rol, mj.suma_net, mj.retinere, mj.suma_bruta
  from public.meci_jucatori mj join public.meciuri m on m.id = mj.meci_id where m.data >= '2026-09-01';

delete from public.tarife_plata where valabil_de_la = '2026-10-06';
insert into public.tarife_plata (valabil_de_la, rol, situatie, net, retinere_pct, observatie) values
  ('2026-09-01', 'căpitan', 'victorie',   184.45, 15, 'Anexa nr. 1 — brut 217'),
  ('2026-09-01', 'căpitan', 'înfrângere', 135.15, 15, 'Anexa nr. 1 — brut 159'),
  ('2026-09-01', 'jucător', 'victorie',   154.70, 15, 'Anexa nr. 1 — brut 182'),
  ('2026-09-01', 'jucător', 'înfrângere', 104.55, 15, 'Anexa nr. 1 — brut 123'),
  ('2026-09-01', 'rezervă', 'victorie',   154.70, 15, 'Anexa nr. 1 — rezerva ca jucătorul, brut 182'),
  ('2026-09-01', 'rezervă', 'înfrângere', 104.55, 15, 'Anexa nr. 1 — rezerva ca jucătorul, brut 123');

alter table public.meci_jucatori disable trigger trg_saptamana_blocata;
update public.meci_jucatori mj set rol = mj.rol          -- the pay trigger recomputes net / withholding / gross
  from public.meciuri m where m.id = mj.meci_id and m.data >= '2026-09-01';
alter table public.meci_jucatori enable trigger trg_saptamana_blocata;

insert into public.jurnal (administrator_id, actiune) values (null,
  'Tarife noi din Anexa nr. 1, valabile de la 01.09.2026: căpitan 184,45 / 135,15 net (brut 217 / 159), jucător și rezervă 154,70 / 104,55 net (brut 182 / 123). Plățile tuturor meciurilor de la 01.09 au fost recalculate, inclusiv săptămânile blocate.');
