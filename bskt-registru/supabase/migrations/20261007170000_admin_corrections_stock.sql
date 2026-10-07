-- Admin corrections: when an admin edits or deletes a clothing / linen / referee-ball entry that was entered wrong,
-- the inventory must follow. Until now stock moved only on insert and on the return toggle.
-- Every adjustment is written to inventar_miscari as 'corectare' so the stock history stays explainable.

-- ───────── vestimentație: item / quantity / return state edited, or row deleted ─────────
-- One trigger replaces credit_stoc_uzat_vestimentatie: it compares the old and the new "footprint"
-- (stock issued from inventar_id, plus the used-stock credit when returned) and moves only the difference.
create or replace function public.ajusteaza_stoc_vestimentatie() returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_old_pair text; v_new_pair text;
  v_old_credit int := 0; v_new_credit int := 0;
begin
  -- 1. stock issued
  if tg_op = 'DELETE' or new.inventar_id is distinct from old.inventar_id or new.cantitate <> old.cantitate then
    if old.inventar_id is not null then
      update public.inventar set iesiri = greatest(0, iesiri - old.cantitate), updated_at = now() where id = old.inventar_id;
      insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv, administrator_id)
        values (old.inventar_id, 'corectare', old.cantitate, 'Corecție vestimentație #' || old.id || ': anulare eliberare', auth.uid());
    end if;
    if tg_op = 'UPDATE' and new.inventar_id is not null then
      update public.inventar set iesiri = iesiri + new.cantitate, updated_at = now() where id = new.inventar_id;
      insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv, administrator_id)
        values (new.inventar_id, 'iesire', new.cantitate, 'Corecție vestimentație #' || new.id || ': eliberare corectată', auth.uid());
    end if;
  end if;

  -- 2. used-stock credit for returned items
  select pereche_uzat_id into v_old_pair from public.inventar where id = old.inventar_id;
  if old.data_returnare is not null and v_old_pair is not null then v_old_credit := old.cantitate; end if;
  if tg_op = 'UPDATE' then
    select pereche_uzat_id into v_new_pair from public.inventar where id = new.inventar_id;
    if new.data_returnare is not null and v_new_pair is not null then v_new_credit := new.cantitate; end if;
  end if;
  if v_old_pair is not distinct from v_new_pair and v_old_credit = v_new_credit then
    return coalesce(new, old);
  end if;
  if v_old_credit > 0 then
    update public.inventar set intrari = greatest(0, intrari - v_old_credit), updated_at = now() where id = v_old_pair;
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv, administrator_id)
      values (v_old_pair, 'corectare', v_old_credit, 'Anulare returnare vestimentație #' || old.id, auth.uid());
  end if;
  if v_new_credit > 0 then
    update public.inventar set intrari = intrari + v_new_credit, updated_at = now() where id = v_new_pair;
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv, administrator_id)
      values (v_new_pair, 'intrare', v_new_credit, 'Returnare vestimentație #' || new.id, auth.uid());
  end if;
  return coalesce(new, old);
end; $$;

drop trigger if exists trg_vestimentatie_uzat_stoc on public.vestimentatie;
create trigger trg_vestimentatie_stoc_corectie after update of inventar_id, cantitate, data_returnare or delete on public.vestimentatie
  for each row execute function public.ajusteaza_stoc_vestimentatie();

-- ───────── lenjerie: stock source changed, or row deleted ─────────
create or replace function public.ajusteaza_stoc_lenjerie() returns trigger language plpgsql security definer set search_path=public as $$
declare v_old text := case when old.sursa_stoc = 'uzat' then 'inv-lenjerie-uzat' else 'inv-lenjerie' end;
        v_new text;
begin
  if tg_op = 'UPDATE' and new.sursa_stoc = old.sursa_stoc then return new; end if;
  update public.inventar set iesiri = greatest(0, iesiri - 1), updated_at = now() where id = v_old;
  insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv, administrator_id)
    values (v_old, 'corectare', 1, 'Corecție set lenjerie #' || old.id || ': anulare eliberare', auth.uid());
  if old.data_returnare is not null then            -- the returned set had been credited to used stock
    update public.inventar set intrari = greatest(0, intrari - 1), updated_at = now() where id = 'inv-lenjerie-uzat';
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv, administrator_id)
      values ('inv-lenjerie-uzat', 'corectare', 1, 'Corecție set lenjerie #' || old.id || ': anulare returnare', auth.uid());
  end if;
  if tg_op = 'UPDATE' then
    v_new := case when new.sursa_stoc = 'uzat' then 'inv-lenjerie-uzat' else 'inv-lenjerie' end;
    update public.inventar set iesiri = iesiri + 1, updated_at = now() where id = v_new;
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv, administrator_id)
      values (v_new, 'iesire', 1, 'Corecție set lenjerie #' || new.id || ': eliberat din ' || new.sursa_stoc, auth.uid());
    if new.data_returnare is not null then
      update public.inventar set intrari = intrari + 1, updated_at = now() where id = 'inv-lenjerie-uzat';
      insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv, administrator_id)
        values ('inv-lenjerie-uzat', 'intrare', 1, 'Corecție set lenjerie #' || new.id || ': returnare', auth.uid());
    end if;
  end if;
  return coalesce(new, old);
end; $$;

-- the existing return-toggle trigger keeps handling data_returnare; this one only reacts to sursa_stoc and deletes
create trigger trg_lenjerie_stoc_corectie after update of sursa_stoc or delete on public.lenjerie
  for each row execute function public.ajusteaza_stoc_lenjerie();

-- ───────── arbitraj: deleting an entry gives the balls back ─────────
create or replace function public.restituie_stoc_arbitraj() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.cantitate_mingi > 0 then
    update public.inventar set iesiri = greatest(0, iesiri - old.cantitate_mingi), updated_at = now() where id = 'inv-mingi';
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv, administrator_id)
      values ('inv-mingi', 'corectare', old.cantitate_mingi, 'Ștergere arbitraj ' || old.arbitru || ' (' || old.turneu || '): mingi restituite', auth.uid());
  end if;
  return old;
end; $$;
create trigger trg_arbitraj_stoc_stergere after delete on public.arbitraj
  for each row execute function public.restituie_stoc_arbitraj();

revoke execute on function public.ajusteaza_stoc_vestimentatie(), public.ajusteaza_stoc_lenjerie(), public.restituie_stoc_arbitraj()
  from public, anon, authenticated;
