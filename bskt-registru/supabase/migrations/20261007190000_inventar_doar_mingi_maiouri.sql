-- Inventory reduced to what BSKT actually shows for now: basketballs + one jersey type ("Maiouri") in every size.
-- The real inventory list is still to be agreed; the bordo/verde jerseys, shorts, used-stock pairs and linen
-- placeholders are removed (none of them had movements, hand-outs or linen records).

delete from public.inventar where id <> 'inv-mingi';

insert into public.inventar (id, denumire, culoare, marime, um, cantitate_initiala, cantitate_minima, conditie)
values
  ('inv-m-s',    'Maiouri', '—', 'S',    'buc', 0, 0, 'nou'),
  ('inv-m-m',    'Maiouri', '—', 'M',    'buc', 0, 0, 'nou'),
  ('inv-m-l',    'Maiouri', '—', 'L',    'buc', 0, 0, 'nou'),
  ('inv-m-xl',   'Maiouri', '—', 'XL',   'buc', 0, 0, 'nou'),
  ('inv-m-xxl',  'Maiouri', '—', 'XXL',  'buc', 0, 0, 'nou'),
  ('inv-m-xxxl', 'Maiouri', '—', 'XXXL', 'buc', 0, 0, 'nou')
on conflict (id) do nothing;

-- Linen is no longer stock-tracked: hand it out without touching inventory when the linen item does not exist.
create or replace function public.deduce_stoc_lenjerie() returns trigger language plpgsql security definer set search_path=public as $$
declare v_inventar_id text; v_stoc_curent integer;
begin
  v_inventar_id := case when new.sursa_stoc = 'uzat' then 'inv-lenjerie-uzat' else 'inv-lenjerie' end;
  select cantitate_initiala + intrari - iesiri into v_stoc_curent from public.inventar where id = v_inventar_id for update;
  if not found then return new; end if;
  if v_stoc_curent <= 0 then raise exception 'LENJERIE_STOC_EPUIZAT:%', new.sursa_stoc; end if;
  update public.inventar set iesiri = iesiri + 1, updated_at = now() where id = v_inventar_id;
  insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv) values (v_inventar_id, 'iesire', 1, 'Set lenjerie eliberat #' || new.id);
  return new;
end; $$;

create or replace function public.credit_stoc_uzat_lenjerie() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not exists (select 1 from public.inventar where id = 'inv-lenjerie-uzat') then return new; end if;
  if old.data_returnare is null and new.data_returnare is not null then
    update public.inventar set intrari = intrari + 1, updated_at = now() where id = 'inv-lenjerie-uzat';
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv) values ('inv-lenjerie-uzat', 'intrare', 1, 'Returnare set lenjerie #' || new.id);
  elsif old.data_returnare is not null and new.data_returnare is null then
    update public.inventar set iesiri = iesiri + 1, updated_at = now() where id = 'inv-lenjerie-uzat';
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv) values ('inv-lenjerie-uzat', 'iesire', 1, 'Anulare returnare set lenjerie #' || new.id);
  end if;
  return new;
end; $$;

create or replace function public.ajusteaza_stoc_lenjerie() returns trigger language plpgsql security definer set search_path=public as $$
declare v_old text := case when old.sursa_stoc = 'uzat' then 'inv-lenjerie-uzat' else 'inv-lenjerie' end;
        v_new text;
begin
  if not exists (select 1 from public.inventar where id in ('inv-lenjerie','inv-lenjerie-uzat')) then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.sursa_stoc = old.sursa_stoc then return new; end if;
  update public.inventar set iesiri = greatest(0, iesiri - 1), updated_at = now() where id = v_old;
  insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv, administrator_id)
    select v_old, 'corectare', 1, 'Corecție set lenjerie #' || old.id || ': anulare eliberare', auth.uid() where exists (select 1 from public.inventar where id = v_old);
  if old.data_returnare is not null then
    update public.inventar set intrari = greatest(0, intrari - 1), updated_at = now() where id = 'inv-lenjerie-uzat';
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv, administrator_id)
      select 'inv-lenjerie-uzat', 'corectare', 1, 'Corecție set lenjerie #' || old.id || ': anulare returnare', auth.uid() where exists (select 1 from public.inventar where id = 'inv-lenjerie-uzat');
  end if;
  if tg_op = 'UPDATE' then
    v_new := case when new.sursa_stoc = 'uzat' then 'inv-lenjerie-uzat' else 'inv-lenjerie' end;
    update public.inventar set iesiri = iesiri + 1, updated_at = now() where id = v_new;
    insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv, administrator_id)
      select v_new, 'iesire', 1, 'Corecție set lenjerie #' || new.id || ': eliberat din ' || new.sursa_stoc, auth.uid() where exists (select 1 from public.inventar where id = v_new);
    if new.data_returnare is not null then
      update public.inventar set intrari = intrari + 1, updated_at = now() where id = 'inv-lenjerie-uzat';
      insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv, administrator_id)
        select 'inv-lenjerie-uzat', 'intrare', 1, 'Corecție set lenjerie #' || new.id || ': returnare', auth.uid() where exists (select 1 from public.inventar where id = 'inv-lenjerie-uzat');
    end if;
  end if;
  return coalesce(new, old);
end; $$;
