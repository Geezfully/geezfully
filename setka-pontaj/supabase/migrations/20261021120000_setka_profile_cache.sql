-- Keep SETKA-PRO's own copy of each linked participant's Setka Cup profile.
--
-- The info card and the table avatars borrowed everything from the ATTP site:
-- stats from its players table, the photo from a file named after the
-- participant. Anyone that pipeline missed got nothing, even with a confirmed
-- Setka link of our own — Goncharov Dmitri (#3010) isn't on the ATTP site at
-- all, and Iusiumbeli Evghenii (#3015) has no photo file, although Setka Cup
-- has both a photo and full stats for each of them.
--
-- setka_profile_refresh() stores, per confirmed link, just what the card and
-- avatars need: city, rating, wins/losses, per-tournament status+placing, and
-- the photo token Setka's image API takes. It runs hourly as its own job and
-- writes nothing but these two columns, so the payroll sync is untouched; one
-- player's failed request is skipped rather than aborting the rest.
--
-- The columns sit on setka_referee_links, so its approved-users-only policy
-- covers them; nothing new is exposed.

alter table public.setka_referee_links
  add column if not exists setka_profile jsonb,
  add column if not exists setka_profile_at timestamptz;

create or replace function public.setka_profile_refresh()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  link record;
  p jsonb;
begin
  for link in
    select referee_id, setka_player_id from public.setka_referee_links
     where match_status = 'confirmed' and setka_player_id is not null
  loop
    begin
      p := public.setka_get_player(link.setka_player_id);
    exception when others then
      continue;
    end;
    if p is null then continue; end if;

    update public.setka_referee_links
       set setka_profile = jsonb_build_object(
             'setka_player_id', link.setka_player_id,
             'city', nullif(p->>'city', ''),
             'photo_token', nullif(p->>'photo', ''),
             'rating_sc', p->'ratingSc',
             'wins', coalesce((p->>'win')::int, 0),
             'losses', coalesce((p->>'lost')::int, 0),
             'total_matches', coalesce((p->>'totalMatches')::int, 0),
             'total_tournaments', (select count(*) from jsonb_array_elements(coalesce(p->'tournamentStats', '[]')) s
                                    where s->>'status' = 'finished'),
             -- "positions" (plural) is Setka's final placing; "position" is an
             -- unrelated seeding value — same rule as refresh_setka_verification.
             'tournament_stats', coalesce((select jsonb_agg(jsonb_build_object(
                                    'status', s->>'status', 'position', nullif(s->>'positions', '')::int))
                                  from jsonb_array_elements(coalesce(p->'tournamentStats', '[]')) s), '[]')
           ),
           setka_profile_at = now()
     where referee_id = link.referee_id
       and setka_player_id = link.setka_player_id;
  end loop;
end;
$$;

revoke all on function public.setka_profile_refresh() from public, anon, authenticated;

select cron.schedule('setka-profile-refresh', '7 * * * *', 'select public.setka_profile_refresh();');
