-- A player can also referee: one person, two profiles kept identical by the database.
-- arbitri.participant_id links them; a change to the shared data on either side reaches the other.
-- statut and comentarii stay separate, because someone can stop playing and keep refereeing.
-- Linking fills the referee from the player. Renaming a referee also renames their arbitraj entries, which hold the name.

alter table public.arbitri add column if not exists participant_id uuid unique references public.participanti(id) on delete set null;
comment on column public.arbitri.participant_id is 'The player profile of a referee who also plays; shared fields stay in sync';

create or replace function public.arbitru_preia_date_jucator() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.participanti;
begin
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

create or replace function public.jucator_spre_arbitru() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.arbitri a set nr_dulap = new.nr_dulap, nume = new.nume, prenume = new.prenume, patronimic = new.patronimic, data_nasterii = new.data_nasterii,
    loc_nastere = new.loc_nastere, adresa = new.adresa, idnp = new.idnp, telefon = new.telefon, email = new.email, serie_act = new.serie_act, nr_act = new.nr_act,
    data_emiterii_act = new.data_emiterii_act, foto_path = new.foto_path, data_aviz_medical = new.data_aviz_medical, freelancer = new.freelancer,
    informat_securitate = new.informat_securitate, acord_date_personale = new.acord_date_personale, beneficiar = new.beneficiar, idno = new.idno, iban = new.iban,
    banca = new.banca, bic = new.bic, valuta = new.valuta, nr_contract = new.nr_contract, data_contract = new.data_contract
  where a.participant_id = new.id
    and (a.nr_dulap, a.nume, a.prenume, a.patronimic, a.data_nasterii, a.loc_nastere, a.adresa, a.idnp, a.telefon, a.email, a.serie_act, a.nr_act,
         a.data_emiterii_act, a.foto_path, a.data_aviz_medical, a.freelancer, a.informat_securitate, a.acord_date_personale, a.beneficiar, a.idno, a.iban,
         a.banca, a.bic, a.valuta, a.nr_contract, a.data_contract)
    is distinct from
        (new.nr_dulap, new.nume, new.prenume, new.patronimic, new.data_nasterii, new.loc_nastere, new.adresa, new.idnp, new.telefon, new.email, new.serie_act, new.nr_act,
         new.data_emiterii_act, new.foto_path, new.data_aviz_medical, new.freelancer, new.informat_securitate, new.acord_date_personale, new.beneficiar, new.idno, new.iban,
         new.banca, new.bic, new.valuta, new.nr_contract, new.data_contract);
  return null;
end $$;

create or replace function public.arbitru_spre_jucator() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.nume, new.prenume) is distinct from (old.nume, old.prenume) then
    update public.arbitraj set arbitru = new.nume || ' ' || new.prenume where arbitru = old.nume || ' ' || old.prenume;
  end if;
  if new.participant_id is null then return null; end if;
  update public.participanti p set nr_dulap = new.nr_dulap, nume = new.nume, prenume = new.prenume, patronimic = new.patronimic, data_nasterii = new.data_nasterii,
    loc_nastere = new.loc_nastere, adresa = new.adresa, idnp = new.idnp, telefon = new.telefon, email = new.email, serie_act = new.serie_act, nr_act = new.nr_act,
    data_emiterii_act = new.data_emiterii_act, foto_path = new.foto_path, data_aviz_medical = new.data_aviz_medical, freelancer = new.freelancer,
    informat_securitate = new.informat_securitate, acord_date_personale = new.acord_date_personale, beneficiar = new.beneficiar, idno = new.idno, iban = new.iban,
    banca = new.banca, bic = new.bic, valuta = new.valuta, nr_contract = new.nr_contract, data_contract = new.data_contract
  where p.id = new.participant_id
    and (p.nr_dulap, p.nume, p.prenume, p.patronimic, p.data_nasterii, p.loc_nastere, p.adresa, p.idnp, p.telefon, p.email, p.serie_act, p.nr_act,
         p.data_emiterii_act, p.foto_path, p.data_aviz_medical, p.freelancer, p.informat_securitate, p.acord_date_personale, p.beneficiar, p.idno, p.iban,
         p.banca, p.bic, p.valuta, p.nr_contract, p.data_contract)
    is distinct from
        (new.nr_dulap, new.nume, new.prenume, new.patronimic, new.data_nasterii, new.loc_nastere, new.adresa, new.idnp, new.telefon, new.email, new.serie_act, new.nr_act,
         new.data_emiterii_act, new.foto_path, new.data_aviz_medical, new.freelancer, new.informat_securitate, new.acord_date_personale, new.beneficiar, new.idno, new.iban,
         new.banca, new.bic, new.valuta, new.nr_contract, new.data_contract);
  return null;
end $$;

drop trigger if exists trg_arbitru_preia_date on public.arbitri;
create trigger trg_arbitru_preia_date before insert or update of participant_id on public.arbitri
  for each row execute function public.arbitru_preia_date_jucator();
drop trigger if exists trg_arbitru_spre_jucator on public.arbitri;
create trigger trg_arbitru_spre_jucator after update on public.arbitri
  for each row execute function public.arbitru_spre_jucator();
drop trigger if exists trg_jucator_spre_arbitru on public.participanti;
create trigger trg_jucator_spre_arbitru after update of nr_dulap, nume, prenume, patronimic, data_nasterii, loc_nastere, adresa, idnp, telefon, email, serie_act, nr_act,
    data_emiterii_act, foto_path, data_aviz_medical, freelancer, informat_securitate, acord_date_personale, beneficiar, idno, iban, banca, bic, valuta, nr_contract, data_contract
  on public.participanti for each row execute function public.jucator_spre_arbitru();

insert into public.arbitri (participant_id, nume, prenume)
  select id, nume, prenume from public.participanti where nr_contract = '105-10' and nume = 'Gheorghiev' and prenume = 'Anatolie'
  on conflict (participant_id) do nothing;

insert into public.jurnal (administrator_id, actiune) values (null,
  'Jucătorii pot fi și arbitri: profilurile legate își păstrează datele comune sincronizate. Gheorghiev Anatolie a fost adăugat ca arbitru, legat de fișa de jucător.');
