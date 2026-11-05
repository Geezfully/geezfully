-- Bring back the women's roster from the old attp.md site (Strapi CMS, 15 players).
--
-- The 19.09.2026 cleanup kept only Setka Cup players, which removed every woman:
-- the women's game is not played on Setka. 13 of the 15 are still in the backup
-- table with their ligas.io link, photo and CMS stats, so they go back unchanged.
-- Halimbaieva and Iamandi were never deleted (they are staff too), they only lack
-- sex/birth year. The site lists women without a Setka account (fetchAllPlayers).
-- Ligas-only girls and amateurs from the same backup stay out on purpose.

insert into public.players
select r.*
from public.players_removed_20260919 r
where (r.last_name, r.first_name) in (
  ('Bostan','Bianca'), ('Caraulinaia','Vlada'), ('Chiriacova','Alexandra'),
  ('Goga','Ana'), ('Leșcinscaia','Inna'), ('Lipcan','Cristina'),
  ('Merenco','Camelia'), ('Mihailov','Victoria'), ('Ni','Aliona'),
  ('Parfeni','Victoria'), ('Prohorovici','Natalia'), ('Sandul','Victoria'),
  ('Yavorskaya','Anastasia')
)
and not exists (select 1 from public.players p where p.id = r.id);

-- Birth years from the old CMS where ligas.io has none.
update public.players p
set sex = 'f', birth_year = coalesce(p.birth_year, v.birth_year)
from (values ('Prohorovici','Natalia',1985), ('Halimbaieva','Oksana',1994), ('Iamandi','Nadejda',2004))
  as v(last_name, first_name, birth_year)
where (p.last_name, p.first_name) = (v.last_name, v.first_name);

-- Reattach their places in the women's ranking (the sync would do it within 15 min).
update public.ligas_ranking r
set player_id = p.id
from public.players p
where p.ligas_user_id = r.ligas_user_id
  and r.player_id is distinct from p.id;
