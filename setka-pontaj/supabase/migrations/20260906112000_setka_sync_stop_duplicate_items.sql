-- Setka sync re-raised the same difference on every cron tick once its batch
-- had been shown to someone.
--
-- setka_sync_pull() looks for an "open" batch to accumulate diffs into, but it
-- defined open as status='pending'. Opening the app flips that batch to
-- 'presented', so the next tick found nothing open, created a second batch,
-- and -- because studio_entries had not been updated yet -- refilled it with
-- exactly the same differences. Every 15 minutes a change sat un-accepted
-- produced another full copy: 588 of the 3319 items ever raised were such
-- re-asks, one cell asked 6 separate times.
--
-- The two halves disagreeing is what gives the oversight away: pull takes the
-- NEWEST pending batch while setka_sync_present_pending takes the OLDEST.
-- Both are only correct if there is never more than one, which is what the
-- original migration assumed -- duplicate batches were never intended.
--
-- Fixed here rather than by widening what pull treats as open. A question the
-- user has not answered yet is refreshed where it already lives, whatever
-- batch that is. Genuinely new differences still open a fresh batch and so
-- still get a full 72h window -- reusing a presented batch would have quietly
-- shortened it, sometimes to minutes. When every difference is already
-- outstanding the tick's new batch ends up empty and pull's existing
-- housekeeping drops it, so empty batches don't accumulate either.
--
-- 'missed' items are deliberately left alone. They are a separate queue the
-- user works through by hand, and a new difference on such a cell should ask
-- a fresh question rather than silently rewrite one that already expired.

create or replace function public.setka_sync_diff_one(
  p_batch_id uuid, p_referee_id uuid, p_studio_id uuid, p_period date,
  p_field text, p_new_value int, p_cur_value int
) returns void language plpgsql security definer set search_path = public as $$
declare
  open_item_id uuid;
begin
  select id into open_item_id
  from public.setka_sync_items
  where referee_id = p_referee_id and studio_id = p_studio_id
    and period = p_period and field = p_field and status = 'pending'
  order by created_at asc
  limit 1;

  if p_cur_value is distinct from p_new_value then
    if open_item_id is not null then
      update public.setka_sync_items
      set new_value = p_new_value, old_value = p_cur_value
      where id = open_item_id
        and (new_value is distinct from p_new_value
             or old_value is distinct from p_cur_value);
    else
      insert into public.setka_sync_items (batch_id, referee_id, studio_id, period, field, old_value, new_value)
      values (p_batch_id, p_referee_id, p_studio_id, p_period, p_field, p_cur_value, p_new_value)
      on conflict (batch_id, referee_id, studio_id, period, field)
      do update set new_value = excluded.new_value, old_value = excluded.old_value
      where public.setka_sync_items.status = 'pending';
    end if;
  else
    -- Setka and the table agree again: withdraw the question wherever it sits,
    -- not only in the batch this tick happens to be filling.
    delete from public.setka_sync_items
    where referee_id = p_referee_id and studio_id = p_studio_id
      and period = p_period and field = p_field and status = 'pending';
  end if;
end;
$$;
