-- Freelancer contract and payment details per player (sole-trader IDNO, bank account, contract).
-- Admins only: the helper (asistent) reads players through participanti_asistent(), which lists its columns
-- explicitly and does not include these.
alter table public.participanti
  add column if not exists idno text,
  add column if not exists beneficiar text,
  add column if not exists iban text,
  add column if not exists banca text,
  add column if not exists bic text,
  add column if not exists valuta text,
  add column if not exists nr_contract text,
  add column if not exists data_contract date,
  add column if not exists telefon_freelance text,
  add column if not exists email_freelance text;

comment on column public.participanti.idno is 'IDNO of the player''s sole-trader company (A.I.), used on the freelancer contract';
comment on column public.participanti.beneficiar is 'Payment beneficiary name, e.g. "A.I. NUME PRENUME"';
comment on column public.participanti.iban is 'IBAN the freelancer is paid to';
comment on column public.participanti.nr_contract is 'Freelancer contract number';
comment on column public.participanti.data_contract is 'Freelancer contract date';
comment on column public.participanti.telefon_freelance is 'Phone number registered for the freelancer activity';
comment on column public.participanti.email_freelance is 'E-mail registered for the freelancer activity / contract';
