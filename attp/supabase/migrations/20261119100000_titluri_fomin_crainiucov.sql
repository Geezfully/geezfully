-- Sport titles requested on 19.11.2026: Fomin - MS, Crainiucov - MS (players.sport_rank is the only source of titles).
update public.players set sport_rank = 'master'
where id in ('7dd36c87-4607-4352-9db8-64b2fdcbf2c1',  -- Alexandr Fomin, Tiraspol (Setka 1669)
             'f6f93b1e-5f0c-4cbf-895f-f90c143f8155')  -- Grigore Crainiucov, Tiraspol (Setka 1578)
  and sport_rank is null;
