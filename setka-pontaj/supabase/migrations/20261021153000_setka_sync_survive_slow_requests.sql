-- Stop one slow Setka Cup response from abandoning the whole 15-minute sync.
--
-- A request that took longer than the http extension's 5 s default raised an
-- error, and since the matcher, the verification refresh and the diff all run
-- in one cron transaction, the entire tick rolled back. Over the week before
-- this, 7–51% of runs a day failed that way (about 20% on a typical day). Nothing
-- was lost — the next successful run caught up — but the data could lag by an
-- hour, which matters around a month-end close.
--
-- 1. setka_get_player / setka_search allow 12 s per request (attp_sync_pull
--    already uses 15 s for the same reason).
-- 2. A request that still fails is skipped for that one player instead of
--    failing the tick. This is exactly what already happens when Setka answers
--    with an error status: setka_get_player returns null and the refresh moves
--    on. A skipped player simply gets no verification rows that run, and the
--    diff only proposes changes from rows that exist, so a skip can never turn
--    into a suggestion to zero someone's figures. They are picked up again 15
--    minutes later.
-- 3. The matcher skips a person whose search fails, leaving their link row as
--    it was, rather than rolling everyone back.
--
-- refresh_setka_verification is unchanged apart from the guarded fetch.

create or replace function public.setka_get_player(p_id integer)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  resp extensions.http_response;
  url text;
begin
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '12000');
  url := 'https://tabletennis.setkacup.com/api/Players/en/' || p_id;
  select * into resp from extensions.http_get(url);
  if resp.status <> 200 then
    return null;
  end if;
  return resp.content::jsonb;
end;
$function$;

create or replace function public.setka_search(p_query text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  resp extensions.http_response;
  url text;
begin
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '12000');
  url := 'https://tabletennis.setkacup.com/api/Players/en?filter=' || replace(p_query, ' ', '%20') || '&page=0&count=10&';
  select * into resp from extensions.http_get(url);
  if resp.status <> 200 then
    return '[]'::jsonb;
  end if;
  return resp.content::jsonb;
end;
$function$;

-- Matcher: identical to 20261021150000 except the guarded search.
create or replace function public.sync_setka_referee_matches()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  r record;
  candidates jsonb;
  exact_match jsonb := null;
  match_count int;
begin
  for r in select * from public.referees where id not in (select referee_id from public.setka_referee_links where match_status in ('confirmed')) loop
    begin
      candidates := public.setka_search(extensions.unaccent(r.last_name));
    exception when others then
      continue;  -- Setka didn't answer in time: leave this person's row as it is
    end;
    select jsonb_agg(c) into candidates
    from jsonb_array_elements(coalesce(candidates,'[]'::jsonb)) c
    where lower(c->>'country') like '%moldova%'
      and not exists (
        select 1 from public.setka_referee_links taken
         where taken.match_status = 'confirmed'
           and taken.setka_player_id = (c->>'id')::int
      );

    if candidates is null or jsonb_array_length(candidates) = 0 then
      insert into public.setka_referee_links (referee_id, match_status)
      values (r.id, 'no_match')
      on conflict (referee_id) do update set match_status='no_match', candidate=null, setka_player_id=null;
      continue;
    end if;

    select count(*) into match_count
    from jsonb_array_elements(candidates) c
    where lower(extensions.unaccent(c->>'firstName')) = lower(extensions.unaccent(r.first_name))
      and lower(extensions.unaccent(c->>'lastName')) = lower(extensions.unaccent(r.last_name));

    if match_count = 1 then
      select c into exact_match
      from jsonb_array_elements(candidates) c
      where lower(extensions.unaccent(c->>'firstName')) = lower(extensions.unaccent(r.first_name))
        and lower(extensions.unaccent(c->>'lastName')) = lower(extensions.unaccent(r.last_name))
      limit 1;
      insert into public.setka_referee_links (referee_id, match_status, setka_player_id, candidate, linked_at)
      values (r.id, 'confirmed', (exact_match->>'id')::int, null, now())
      on conflict (referee_id) do update set match_status='confirmed', setka_player_id=(exact_match->>'id')::int, candidate=null, linked_at=now();
    else
      insert into public.setka_referee_links (referee_id, match_status, candidate)
      values (r.id, 'pending_review', candidates)
      on conflict (referee_id) do update set match_status='pending_review', candidate=EXCLUDED.candidate, setka_player_id=null;
    end if;
  end loop;
end;
$function$;

-- Verification refresh: identical to 20260826142249 except the guarded fetch.
create or replace function public.refresh_setka_verification(p_from date, p_to date)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  link record;
  profile jsonb;
  stat jsonb;
  t_name text;
  t_date date;
  v_period date;
  v_studio_id uuid;
  is_day boolean;
  is_night boolean;
  is_night1 boolean;
  mexico_id uuid;
  rio_id uuid;
  day_token int;
  loc_id int;
  final_pos int;
begin
  select id into mexico_id from public.studios where name = 'MEXICO';
  select id into rio_id from public.studios where name = 'RIO';

  delete from public.setka_verification where period >= p_from and period < p_to;
  delete from public.setka_verification_unclassified where start_date >= p_from and start_date < p_to;

  for link in select * from public.setka_referee_links where match_status = 'confirmed' loop
    begin
      profile := public.setka_get_player(link.setka_player_id);
    exception when others then
      continue;  -- same outcome as an error status: this player sits out one run
    end;
    if profile is null then continue; end if;

    for stat in select * from jsonb_array_elements(coalesce(profile->'tournamentStats','[]'::jsonb)) loop
      t_date := (stat->>'startDate')::date;
      if t_date is null then continue; end if;
      t_name := coalesce(stat->>'name','');
      day_token := nullif(stat->>'dayPeriodToken','')::int;
      loc_id := nullif(stat->>'locationId','')::int;
      -- "positions" (plural) is Setka's actual final-ranking field; "position" is an
      -- unrelated seeding/ranking value and must not be used for Locul I/III.
      final_pos := nullif(stat->>'positions','')::int;

      -- Night1 (~00:00-03:40 UTC, ~03:00-06:40 Moldova time) is the tail end of the
      -- PREVIOUS calendar day's night shift, not a new day's session. Resolve that
      -- to an effective date first, then bucket it through business_period() so the
      -- one-time 2026 August/September boundary is honoured here as well. Composing
      -- them this way keeps a Night1 in the small hours of 28 Aug inside August,
      -- because its effective date is the 27th.
      is_night1 := day_token = 6 or (day_token is null and t_name ilike '%night1%');
      v_period := public.business_period(
        case when is_night1 then (t_date - interval '1 day')::date else t_date end
      );
      if v_period < p_from or v_period >= p_to then continue; end if;

      v_studio_id := case
        when loc_id = 18 then mexico_id
        when loc_id = 19 then rio_id
        when t_name ilike '%mexico%' then mexico_id
        when t_name ilike '%rio%' then rio_id
        else null
      end;

      -- dayPeriodToken: 2=Evening, 5=Day2 -> zi; 3=Night, 6=Night1 -> noapte.
      -- Falls back to name matching only if the token is ever missing.
      if day_token is not null then
        is_day := day_token in (2,5);
        is_night := day_token in (3,6);
      else
        is_day := t_name ilike '%day%' or t_name ilike '%evening%';
        is_night := t_name ilike '%night%';
      end if;

      if v_studio_id is null or (not is_day and not is_night) or (is_day and is_night) then
        insert into public.setka_verification_unclassified (referee_id, tournament_name, start_date, reason)
        values (link.referee_id, t_name, t_date,
          case when v_studio_id is null then 'unknown studio'
               when (is_day and is_night) then 'ambiguous day/night'
               else 'unknown day/night' end);
        continue;
      end if;

      insert into public.setka_verification (referee_id, studio_id, period, tournament_day, tournament_night, matches_day, matches_night, place1_day, place1_night, place3_day, place3_night)
      values (
        link.referee_id, v_studio_id, v_period,
        case when is_day then 1 else 0 end,
        case when is_night then 1 else 0 end,
        case when is_day then coalesce((stat->>'matchWin')::int,0) else 0 end,
        case when is_night then coalesce((stat->>'matchWin')::int,0) else 0 end,
        case when is_day and final_pos = 1 then 1 else 0 end,
        case when is_night and final_pos = 1 then 1 else 0 end,
        case when is_day and final_pos = 3 then 1 else 0 end,
        case when is_night and final_pos = 3 then 1 else 0 end
      )
      on conflict (referee_id, studio_id, period) do update set
        tournament_day = setka_verification.tournament_day + excluded.tournament_day,
        tournament_night = setka_verification.tournament_night + excluded.tournament_night,
        matches_day = setka_verification.matches_day + excluded.matches_day,
        matches_night = setka_verification.matches_night + excluded.matches_night,
        place1_day = setka_verification.place1_day + excluded.place1_day,
        place1_night = setka_verification.place1_night + excluded.place1_night,
        place3_day = setka_verification.place3_day + excluded.place3_day,
        place3_night = setka_verification.place3_night + excluded.place3_night,
        computed_at = now();
    end loop;
  end loop;
end;
$function$;
