-- Participants whose name on Setka Cup differs from the register, linked by
-- hand from the Setka profile links the admin provided. setka_legat_manual
-- keeps the automatic name matching from ever changing them.
-- Birth year checked against Setka for each one.
begin;

update public.participanti set setka_id = v.setka_id, setka_legat_manual = true
  from (values
    ('486752e0-c63e-67d5-3c21-46634ba4bacb'::uuid, 2816), -- Afendi Vladimir = Volodymyr Afendi, Chișinău, 1981
    ('f96b6042-ff32-412e-13f8-79a4656091c0'::uuid, 1663), -- Cioclea Igor Vasile = Igor V Cioclea, Chișinău, 1980
    ('4ffe83a1-daef-6956-4214-d1acdc3c5b9f'::uuid, 1593), -- Dumitriu Vitalie Mihail = Vitaliy Dumitriu, Briceni, 1971
    ('637b96a2-476b-3e93-7ff4-b9918d85a6d4'::uuid, 2985), -- Efros Iurii Anastas = Iuri Efros, Rîbnița, 1966
    ('4ec038d4-f9eb-dfa3-198c-d886cc123a1e'::uuid, 2784), -- Gașlama Alexandr = Alexandr Gashlama, Chișinău, 2004
    ('864d7faa-582b-5114-50c4-32d8011b5539'::uuid, 3010), -- Goncearov Dmitrii Serghei = Dmitri Goncharov, Rîbnița, 1973
    ('60faa3e5-3605-4ff1-a92b-3cee54776a50'::uuid, 2935), -- Grabovoi Ruslan = Ruslan Grabovoy, Chișinău, 1967
    ('7381f834-f98f-fa34-bfc7-120fffb3a348'::uuid, 1822), -- Iurcenco Iurii Vasile = Iuri Iurcenco, Chișinău, 1964
    ('96b1ee0d-94df-4cc7-a2b7-ef8b50418491'::uuid, 3015), -- Iusiumbeli Eughenii = Evghenii Iusiumbeli, Ceadîr-Lunga, 2002
    ('9ad19ed3-e289-7ad7-a141-6d0f2830150b'::uuid, 2104), -- Mițul Anatolii Nichita = Anatoli Mitul, Dubăsari, 1961
    ('28e7cc28-6bad-a79f-5121-e34d59c71e98'::uuid, 1548), -- Oanța Mihai Alexei = Mihail Oanta, Chișinău, 1966
    ('c0bd9d18-4676-21c9-e624-976dcfa3ad0e'::uuid, 1774), -- Paniivan Ghennadi Vladimir = Hennadii Paniivan, Rîbnița, 1967
    ('573efaac-9e44-ee35-43ae-591710f0ed46'::uuid, 2954), -- Salcuțanu Veaceslav Mihail = Veaceslav Salcutan, Ialoveni, 1977
    ('05043ea2-4a08-8ba1-c5fb-81bbc7c41663'::uuid, 2560), -- Șchipu Serghei Semion = Serghei Schiopu, Ialoveni, 1972 (not Șchiopu Sergiu, 2004 = Setka 1561)
    ('4c67ee38-47f5-c514-6709-a02e14fac30f'::uuid, 1784), -- Titov Danila Alexei = Danil Titov, Chișinău, 2001 (Pontaj birth dates of the two Titovs look swapped)
    ('b6387c2d-e8a7-1ae0-a201-0da107cc5578'::uuid, 1996), -- Ursu Serghei Alexandr = Sergiu Ursu, Chișinău, 1961
    ('ca1948b2-6c8e-f01b-85ad-8e195c25df53'::uuid, 2801), -- Veremiiciuk Yaroslav = Yaroslav Veremiichuk, Chișinău, 2007
    ('e298a9f1-752f-fcbd-98c0-25171dcf9c32'::uuid, 2892), -- Duplii Alexandr Vladimir = Alexandru Duplii, Chișinău, 1993
    ('701be5dd-fac0-ef71-a93e-9d2bf4276904'::uuid, 755)   -- Halimbaieva Oksana Rustam -> Setka 'Rustam Halimbaiev' (Kryvyi Rih, 1973): linked on the admin's instruction; Pontaj name left as is
  ) as v(participant_id, setka_id)
 where participanti.id = v.participant_id;

commit;
