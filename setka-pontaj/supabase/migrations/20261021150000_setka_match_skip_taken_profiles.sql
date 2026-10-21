-- Never offer a Setka profile that is already linked to someone else.
--
-- The matcher searches Setka Cup by surname alone. When the surname matched
-- but the full name didn't, it stored every hit as a "pending review"
-- suggestion — including profiles already confirmed for another participant.
-- Barancean Daria (a referee with no Setka account) was left with Barancean
-- Sergiu's profile (#1944) as her suggested match, although #1944 has been
-- confirmed for Barancean Sergiu since July. Confirming it would have fed his
-- tournaments into her row.
--
-- Clearing her row by hand wouldn't last: the matcher re-checks every
-- unlinked participant each 15 minutes and would put the suggestion back. So
-- a taken profile is dropped from the candidates before anything else. That
-- also stops an exact namesake from being auto-confirmed onto a profile that
-- already belongs to someone. With nothing left to suggest, Daria becomes
-- 'no_match' like the other referees without an account, and is still picked
-- up automatically if she ever registers under her own name.
--
-- Only the candidate filter changes; the rest is the function as it was.

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
    candidates := public.setka_search(extensions.unaccent(r.last_name));
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

-- Clear the stale suggestion now rather than waiting for the next tick.
update public.setka_referee_links l
   set match_status = 'no_match', candidate = null, setka_player_id = null
 where l.match_status = 'pending_review'
   and not exists (
     select 1 from jsonb_array_elements(coalesce(l.candidate, '[]'::jsonb)) c
      where not exists (
        select 1 from public.setka_referee_links taken
         where taken.match_status = 'confirmed' and taken.setka_player_id = (c->>'id')::int));
