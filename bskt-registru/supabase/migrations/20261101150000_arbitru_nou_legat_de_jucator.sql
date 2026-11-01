-- A referee added with the same name as exactly one player is that player: link them on insert.
-- Also fixes the double created when Gheorghiev Anatolie was added by hand minutes before the previous migration
-- added him again: the linked copy goes, and the one added by hand takes the link. Neither had any hours.

create or replace function public.arbitru_preia_date_jucator() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.participanti; ids uuid[];
begin
  if tg_op = 'INSERT' and new.participant_id is null then
    select array_agg(id) into ids from public.participanti where lower(nume) = lower(new.nume) and lower(prenume) = lower(new.prenume);
    if array_length(ids, 1) = 1 and not exists (select 1 from public.arbitri a where a.participant_id = ids[1]) then new.participant_id := ids[1]; end if;
  end if;
  if new.participant_id is null or (tg_op = 'UPDATE' and new.participant_id is not distinct from old.participant_id) then return new; end if;
  select * into p from public.participanti where id = new.participant_id;
  new.nr_dulap := coalesce(p.nr_dulap, new.nr_dulap); new.nume := p.nume; new.prenume := p.prenume;
  new.patronimic := coalesce(p.patronimic, new.patronimic); new.data_nasterii := coalesce(p.data_nasterii, new.data_nasterii);
  new.loc_nastere := coalesce(p.loc_nastere, new.loc_nastere); new.adresa := coalesce(p.adresa, new.adresa);
  new.idnp := coalesce(p.idnp, new.idnp); new.telefon := coalesce(p.telefon, new.telefon); new.email := coalesce(p.email, new.email);
  new.serie_act := coalesce(p.serie_act, new.serie_act); new.nr_act := coalesce(p.nr_act, new.nr_act);
  new.data_emiterii_act := coalesce(p.data_emiterii_act, new.data_emiterii_act); new.foto_path := coalesce(p.foto_path, new.foto_path);
  new.data_aviz_medical := coalesce(p.data_aviz_medical, new.data_aviz_medical); new.freelancer := p.freelancer;
  new.informat_securitate := p.informat_securitate; new.acord_date_personale := p.acord_date_personale;
  new.beneficiar := coalesce(p.beneficiar, new.beneficiar); new.idno := coalesce(p.idno, new.idno); new.iban := coalesce(p.iban, new.iban);
  new.banca := coalesce(p.banca, new.banca); new.bic := coalesce(p.bic, new.bic); new.valuta := coalesce(p.valuta, new.valuta);
  new.nr_contract := coalesce(p.nr_contract, new.nr_contract); new.data_contract := coalesce(p.data_contract, new.data_contract);
  return new;
end $$;

delete from public.arbitri a where a.participant_id is not null
  and exists (select 1 from public.arbitri b where b.participant_id is null and b.nume = a.nume and b.prenume = a.prenume);
update public.arbitri a set participant_id = p.id from public.participanti p
  where a.participant_id is null and p.nr_contract = '105-10' and a.nume = p.nume and a.prenume = p.prenume;
