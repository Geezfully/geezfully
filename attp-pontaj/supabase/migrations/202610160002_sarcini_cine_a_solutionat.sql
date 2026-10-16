-- Sarcini: choose who actually solved a task.
--
-- schimba_status_sarcina() credits a solved task to whoever holds the active shift (or the
-- logged-in admin), but administrators sometimes finish tasks outside their own shift.
-- This function only changes the "solved by" fields of an already solved task; status,
-- dates and the status history stay as they are. Every change is written to the journal.
--
-- Exactly one of the two ids is given:
--   p_administrator_serviciu_id  a person from the shift roster (serviciu_administratori)
--   p_admin_id                   an admin account (only full admins may pick one)
-- Allowed for full admins and for the location account while it has an open shift.
begin;

create or replace function public.seteaza_solutionare_sarcina(
  p_sarcina_id uuid,
  p_administrator_serviciu_id uuid default null,
  p_admin_id uuid default null
)
returns setof public.sarcini
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_shift_service_id uuid;
  v_actor_name text;
  v_new_name text;
  v_status text;
  v_descriere text;
begin
  if v_uid is null then
    raise exception 'Autentificare necesară';
  end if;
  if (p_administrator_serviciu_id is null) = (p_admin_id is null) then
    raise exception 'Alegeți un singur administrator';
  end if;
  if not public.can_edit_register() then
    raise exception 'Nu există un schimb activ';
  end if;
  if p_admin_id is not null and not public.is_full_admin() then
    raise exception 'Doar un administrator poate alege un cont de administrator';
  end if;

  select s.status, s.descriere into v_status, v_descriere
    from public.sarcini s where s.id = p_sarcina_id for update;
  if not found then
    raise exception 'Sarcina nu există';
  end if;
  if v_status <> 'soluționat' then
    raise exception 'Sarcina nu este soluționată';
  end if;

  if p_administrator_serviciu_id is not null then
    select sa.nume into v_new_name from public.serviciu_administratori sa where sa.id = p_administrator_serviciu_id;
    if v_new_name is null then raise exception 'Administrator necunoscut'; end if;
  else
    select concat_ws(' ', a.nume, a.prenume) into v_new_name
      from public.administratori a where a.id = p_admin_id and a.rol = 'admin';
    if v_new_name is null then raise exception 'Administrator necunoscut'; end if;
  end if;

  if not public.is_full_admin() then
    select s.administrator_serviciu_id into v_shift_service_id
      from public.sesiuni_schimb s
     where s.cont_id = v_uid and s.ended_at is null
     order by s.started_at desc limit 1;
    select sa.nume into v_actor_name from public.serviciu_administratori sa where sa.id = v_shift_service_id;
  else
    select concat_ws(' ', a.nume, a.prenume) into v_actor_name from public.administratori a where a.id = v_uid;
  end if;

  update public.sarcini
     set administrator_serviciu_solutionare_id = p_administrator_serviciu_id,
         -- a roster pick keeps the account that recorded it; an admin pick is that admin
         admin_solutionare_id = coalesce(p_admin_id, admin_solutionare_id, v_uid)
   where id = p_sarcina_id;

  insert into public.jurnal(administrator_id, administrator_serviciu_id, actiune)
  values (v_uid, v_shift_service_id,
          coalesce(v_actor_name, 'Administrator') || ' a indicat că sarcina „' || v_descriere ||
          '” a fost soluționată de ' || v_new_name);

  return query select * from public.sarcini where id = p_sarcina_id;
end;
$$;

revoke all on function public.seteaza_solutionare_sarcina(uuid, uuid, uuid) from public, anon;
grant execute on function public.seteaza_solutionare_sarcina(uuid, uuid, uuid) to authenticated;

commit;
