begin;

alter table public.lenjerie
  add column if not exists sursa_stoc text not null default 'nou';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.lenjerie'::regclass
      and conname = 'lenjerie_sursa_stoc_check'
  ) then
    alter table public.lenjerie
      add constraint lenjerie_sursa_stoc_check
      check (sursa_stoc in ('nou', 'uzat'));
  end if;
end
$$;

create or replace function public.deduce_stoc_lenjerie()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inventar_id text;
  v_stoc_curent integer;
begin
  v_inventar_id := case
    when new.sursa_stoc = 'uzat' then 'inv-lenjerie-uzat'
    else 'inv-lenjerie'
  end;

  select cantitate_initiala + intrari - iesiri
    into v_stoc_curent
    from public.inventar
   where id = v_inventar_id
   for update;

  if v_stoc_curent is null then
    raise exception 'LENJERIE_STOC_LIPSA:%', new.sursa_stoc;
  end if;

  if v_stoc_curent <= 0 then
    raise exception 'LENJERIE_STOC_EPUIZAT:%', new.sursa_stoc;
  end if;

  update public.inventar
     set iesiri = iesiri + 1,
         updated_at = now()
   where id = v_inventar_id;

  insert into public.inventar_miscari (inventar_id, tip, cantitate, motiv)
  values (v_inventar_id, 'iesire', 1, 'Set lenjerie eliberat #' || new.id);

  return new;
end;
$$;

commit;
