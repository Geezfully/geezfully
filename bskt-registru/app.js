/* BSKT Registru — application code (split out of index.html; keep the ?v= in index.html in step when deploying) */
/* ══════════════════════ STATE ══════════════════════ */
const SUPABASE_URL = 'https://sbkobwcuywnnmjsbrzqi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__9ImE3WKaboAnDbsZaCy5A_Kl5Q3_8v';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helper ("asistent") accounts are read-only. The database refuses their writes (RLS + a
// statement trigger that errors instead of silently changing 0 rows); this guard stops any
// write the UI might still offer before it leaves the browser, and says so on screen.
const ASISTENT_READ_RPCS = new Set(['statistici_jucatori','statistici_echipe','participanti_asistent','arbitri_asistent',
  'asistent_salveaza_meci','asistent_salveaza_echipa','asistent_salveaza_jucator','asistent_salveaza_arbitru']);
function readOnlyRefusal(){
  const error = { message: t('as_readOnly'), code: 'asistent_read_only' };
  alert(t('as_readOnly'));
  const result = { data:null, error };
  const chain = new Proxy(function(){}, {
    get(_, prop){ return prop==='then' ? (ok, ko)=>Promise.resolve(result).then(ok, ko) : ()=>chain; },
    apply(){ return chain; },
  });
  return chain;
}
{
  const from = sb.from.bind(sb), rpc = sb.rpc.bind(sb), storageFrom = sb.storage.from.bind(sb.storage);
  sb.from = table => {
    const q = from(table);
    if(isAsistent()) for(const m of ['insert','update','upsert','delete']) q[m] = readOnlyRefusal;
    return q;
  };
  sb.rpc = (fn, args, opts) => isAsistent() && !ASISTENT_READ_RPCS.has(fn) ? readOnlyRefusal() : rpc(fn, args, opts);
  sb.storage.from = bucket => {
    const b = storageFrom(bucket);
    if(isAsistent()) for(const m of ['upload','update','remove','move','copy']) b[m] = readOnlyRefusal;
    return b;
  };
}

// Courts and trainers are editable in Setări (stored in app_config); these are the fallbacks.
const DEFAULT_TERENURI = ['Teren 1'];
// referee pay: every referee, alone or in a pair, gets `ora` MDL net per hour worked;
// the company pays the gross amount = net ÷ (1 − retinerePct%), same rule as the players
const DEFAULT_TARIF_ARBITRI = { ora:80, retinerePct:15 };
function refereeGross(net){ return Math.round(net/(1-TARIF_ARBITRI.retinerePct/100)*100)/100; }
// Freelancer (default on): pays the 15% tax itself, so the company pays the GROSS and the person keeps the net.
// Not a freelancer: taxes go another way, the company pays the NET. Both end up with the same net.
function isFreelancer(pid){ return participant(pid)?.freelancer !== false; }
function refereeByName(name){ return DB.arbitri.find(a=>`${a.nume} ${a.prenume}`===name) || null; }
function refereeFreelancer(name){ return refereeByName(name)?.freelancer !== false; }
function freelancerBadge(on){ return `<span class="badge ${on?'green':'muted'}">${t(on?'fl_da':'fl_nu')}</span>`; }
let TARIF_ARBITRI = { ...DEFAULT_TARIF_ARBITRI };
let TERENURI = DEFAULT_TERENURI.slice();
let TRAINERS = [];
const TRAINING_SUMA_JUCATOR = 100;
const TRAINING_SUMA_ANTRENOR = 200;
const MONTH_NAMES = {
  ro: ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie','Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie'],
  ru: ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'],
};
function monthLabel(yyyyMM){
  const [y,m] = yyyyMM.split('-').map(Number);
  return `${MONTH_NAMES[LANG==='ru'?'ru':'ro'][m-1]} ${y}`;
}
// Kit handed out at the venue; `cod` builds the inventory id: inv-<cod>-<size>.
// For now BSKT tracks a single jersey type in every size (the real kit list is still to be agreed).
const CLOTHING_TYPES = [
  { cod:'m', tip:'Maiou', culoare:'—' },
];
const CLOTHING_SIZES = ['S','M','L','XL','XXL','XXXL'];
const PLAYER_SIZES = ['S','M','L','XL','XXL','XXXL'];
const SPORT_CATEGORIES = ['MS','CMS','Categoria I','Categoria II','Categoria III','Amator'];
const TEAM_ROLES = ['căpitan','jucător','arbitru'];
const MATCH_ROLES = ['căpitan','jucător','rezervă'];
// basketball sanctions, from mild to severe
const FAIRPLAY_TYPES = ['avertisment','fault tehnic','fault antisportiv','descalificare'];
const FAIRPLAY_BADGE = { 'avertisment':'muted', 'fault tehnic':'yellow', 'fault antisportiv':'amber', 'descalificare':'red' };
const OBS_CATEGORIES = ['Joc dur','Simptome de boală','Fără legitimație','Absent','Lipsă echipament','Comportament nesportiv','Conflict','Altă situație'];

/* ══════════════════════ I18N ══════════════════════ */
let LANG = localStorage.getItem('bskt-lang') || 'ro';
function t(key, lang=LANG){
  const v = (I18N[lang] && I18N[lang][key]) || I18N.ro[key] || key;
  return Array.isArray(v) ? v[v.length-1] : v;   // plural lists: bare t() gives the "many" form
}
// Count words: RU [1, 2–4, 5+] (21 матч, 22 матча, 25 матчей, 11–14 → матчей);
// RO [1, other] plus the obligatory "de" from 20 up (1 meci, 5 meciuri, 24 de meciuri).
function plural(n, key, lang=LANG){
  const v = (I18N[lang] && I18N[lang][key]) || I18N.ro[key] || key;
  if(!Array.isArray(v)) return v;
  const a = Math.abs(Math.trunc(Number(n)||0));
  if(lang==='ru'){
    const m10 = a%10, m100 = a%100;
    if(m10===1 && m100!==11) return v[0];
    if(m10>=2 && m10<=4 && (m100<12 || m100>14)) return v[1];
    return v[2];
  }
  if(a===1) return v[0];
  const m100 = a%100;
  return (a===0 || (m100>=1 && m100<=19)) ? v[1] : 'de '+v[1];
}
function setLang(l){
  LANG = l; localStorage.setItem('bskt-lang', l);
  applyStaticI18n();
  if (DB) { buildSidebar(); navigate(currentView); }
  if(refreshReminderKind) showRefreshReminder(refreshReminderKind);
  renderInviteRole();
}
function applyStaticI18n(){
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('.lang-btn').forEach(el => el.classList.toggle('active', el.dataset.lang===LANG));
  document.documentElement.lang = LANG;
}
// valorile din baza de date (statut/status/stare) rămân în română (constrângeri CHECK) — se traduc doar la afișare
const ENUM_RU = {
  'activ':'активен', 'inactiv':'неактивен',
  'nesoluționat':'не решено', 'în lucru':'в работе', 'soluționat':'решено',
  'afectat':'затронуто', 'deteriorat':'повреждено', 'distrus':'уничтожено',
  'expirat':'истёк', 'expiră curând':'скоро истекает', 'valabil':'действителен', 'fără aviz':'нет справки',
  'returnat':'возвращено', 'nereturnat':'не возвращено',
  'galben':'жёлтая', 'roșu':'красная', 'închis':'закрыто',
  'bună':'хорошее', 'minim':'минимум', 'sub minim':'ниже минимума', 'zero':'ноль',
  'Maiou roșu':'Красная майка', 'Maiou albastru':'Синяя майка',
  'Roșu':'Красный', 'Albastru':'Синий', 'Albă':'Белый',
  'Joc pasiv':'Пассивная игра', 'Simptome de boală':'Симптомы болезни', 'Fără cartelă':'Без карты',
  'Absent':'Отсутствует', 'Lipsă vestimentație':'Нет формы', 'Comportament necorespunzător':'Ненадлежащее поведение',
  'Conflict':'Конфликт', 'Altă situație':'Другая ситуация',
  'intrare':'приход', 'iesire':'расход', 'corectare':'корректировка',
  'Maiouri roșii':'Красные майки', 'Maiouri albastre':'Синие майки', 'Mingi noi':'Новые мячи',
  'Mingi noi DHS':'Новые мячи DHS', 'Mingi noi JOOLA':'Новые мячи JOOLA', 'Șorturi':'Шорты',
  'Seturi lenjerie':'Комплекты белья',
};
function trEnum(v, lang=LANG){ return (lang==='ru' && ENUM_RU[v]) ? ENUM_RU[v] : v; }

const I18N = {
ro: {
  au_sub:'Registru electronic · BSKT Cup 3×3', au_email:'E-mail', au_pass:'Parolă', au_login:'Autentificare',
  au_loading:'Se autentifică…', au_needBoth:'Introduceți e-mail și parolă.', au_badCreds:'E-mail sau parolă incorectă.', au_noAccess:'Acest cont nu are acces la registru.', pl_saptamana:'Săptămâna', pl_blocata:'Blocată', pl_deschisa:'Deschisă', pl_blocheaza:'Blochează', pl_deblocheaza:'Deblochează', pl_confirmBlocare:(s)=>`Blocați săptămâna ${s}? După blocare, nimeni nu mai poate modifica meciurile, scorurile și loturile ei — nici manual, nici tabelul Google, nici site-ul.`, pl_confirmDeblocare:(s)=>`ATENȚIE: săptămâna ${s} este blocată. Deblocarea permite din nou modificări ale meciurilor, loturilor și plăților ei (manual, din tabel și de pe site). Deblocați?`, pl_blocataTitlu:'Săptămâna acestui meci este blocată. Deblocați-o din Plăți pentru a face modificări.', al_typeSync:'Tabel', al_tabelNume:(n)=>`${n} nume din tabelul Google așteaptă confirmare (Setări → Tabel Google). Loturile cu aceste nume nu se importă până atunci.`, tb_title:'Tabel Google (meciuri, loturi, rating)', tb_sub:'Tabelul este sursa principală: rezultatele (foaia Results), loturile (foile PD_zz.ll.aaaa), ratingul și echipa jucătorilor (Player data). Site-ul 3x3.bsktcup.com rămâne rezervă. Ce modificați manual în aplicație rămâne așa — sincronizarea nu suprascrie modificările manuale și nu recreează meciurile șterse. Săptămânile blocate nu se modifică deloc.', tb_neconfigurat:'Tabelul nu este conectat încă — urmați pașii de mai jos.', tb_ultima:'Ultima sincronizare:', tb_niciodata:'Conectat, încă nesincronizat.', tb_meciuriTabel:'meciuri în tabel', tb_conflicte:'diferențe păstrate manual', tb_loturiAsteapta:'loturi așteaptă nume', tb_simuleaza:'Simulează (fără modificări)', tb_conectare:'Conectarea tabelului', tb_pas1:'În tabel: Extensii → Apps Script → <b>+ lângă „Fișiere” → Script</b>, numiți-l „bskt-registru-sync”, lipiți scriptul în acest fișier NOU → Salvare. <b>Nu ștergeți și nu modificați scripturile care există deja</b> (de ex. updatePlayerData).', tb_pas2:'Generați cheia secretă și puneți-o în Apps Script → Setări proiect → Proprietăți script: <b>CHEIE</b> = cheia de mai jos.', tb_pas3:'În Apps Script: Implementare → Implementare nouă → Aplicație web → Execută ca: Eu → Acces: Oricine → Implementare → autorizați.', tb_pas4:'Copiați linkul aplicației web (…/exec) și salvați-l aici:', tb_faraCheie:'nicio cheie generată', tb_arata:'Arată', tb_ascunde:'Ascunde', tb_genereazaCheie:'Generează cheia', tb_cheieNoua:'Cheie nouă', tb_confirmCheieNoua:'Generați o cheie nouă? Cea veche nu va mai funcționa: trebuie pusă și cheia nouă în Apps Script (Proprietăți script → CHEIE).', tb_numeTitlu:'Nume din tabel de confirmat', tb_numeSub:'Numele potrivite exact se leagă automat. Pentru celelalte alegeți jucătorul din registru (propunerea e deja selectată) sau creați un jucător nou. Alegerea se memorează.', tb_numeNiciunul:'Niciun nume de confirmat.', tb_alegeJucator:'Alegeți jucătorul din registru', tb_leaga:'Leagă', tb_jucatorNou:'Jucător nou', tb_numePrenume:'Completați numele și prenumele jucătorului nou.', tb_confirmNou:(n)=>`Creați jucătorul nou „${n}”? Fișa personală (IDNP, act etc.) se completează ulterior din profilul lui.`, tb_legate:(n)=>`Nume legate (${n}) — verificați sau schimbați`, tb_inTabel:'În tabel', tb_inRegistru:'În registru', tb_st_auto:'automat', tb_st_confirmat:'confirmat', tb_st_nou:'creat nou', tb_schimba:'Schimbă', tb_eroare:'Sincronizarea cu tabelul a eșuat:', tb_raport:'Sincronizare cu tabelul', tb_raportSimulare:'Simulare — nimic nu a fost modificat', tb_simulareNota:'Aceasta este doar o simulare: arată ce s-ar schimba. Nimic nu a fost salvat.', tb_noi:'meciuri noi', tb_actualizate:'meciuri actualizate', tb_loturiSchimbate:'loturi completate', tb_r_nume_noi:'Nume noi de confirmat', tb_r_conflicte:'Modificate manual (păstrate)', tb_r_blocate:'În săptămâni blocate (neschimbate)', tb_r_loturi_in_asteptare:'Loturi care așteaptă confirmarea unor nume', tb_r_schimbari:'Schimbări', tb_r_echipe_necunoscute:'Echipe necunoscute', tb_r_erori:'Erori', tb_aplicatia:'aplicația', tb_tabelul:'tabelul', tb_nou:'nou', tb_inchide:'Închide', tb_ultimaTabel:'Ultima sincronizare cu tabelul Google:', tb_azi:'azi', tb_syncCuTabelul:'Sincronizează cu tabelul', tb_syncScurt:'Sincronizează', tb_syncTitlu:'Preia acum meciurile, loturile și ratingurile din tabelul Google', tb_tSincronizat:'Sincronizat:', tb_tLaZi:'Totul este la zi cu tabelul.', tb_tLoturi:(n)=>`${n} ${n===1?'lot':'loturi'}`, tb_tMeciuri:(n)=>`${n} ${n===1?'meci actualizat':'meciuri actualizate'}`, tb_tNume:(n)=>`${n} nume de confirmat (Setări)`, tb_tConflicte:(n)=>`${n} ${n===1?'modificare manuală păstrată':'modificări manuale păstrate'}`, tb_tRaport:'Raport', tb_numeDeConfirmat:'nume de confirmat', tb_badgeTabel:'Tabel', tb_dinTabelTitlu:'Rezultat și lot din tabelul Google', tb_badgeManual:'modificat manual', tb_manualTitlu:'Acest meci a fost modificat manual după sincronizare; tabelul și site-ul nu îl mai suprascriu.', tb_preia:'Preia din tabel', tb_confirmPreia:'Renunțați la modificările manuale ale acestui meci și preluați din nou scorul și loturile din tabel?', iv2_title:'Creează-ți contul', iv2_nume:'Nume afișat', iv2_numePh:'ex. Ion Popescu', iv2_passPh:'minim 8 caractere', iv2_pass2:'Confirmă parola', iv2_btn:'Creează contul', iv2_checking:'Se verifică linkul…', iv2_role:(rol,exp)=>`Acces: ${rol} · linkul expiră la ${exp}`, iv2_errInvalid:'Linkul nu este valid. Cereți administratorului un link nou.', iv2_errUsed:'Acest link a fost deja folosit. Fiecare link creează un singur cont.', iv2_errExpired:'Linkul a expirat. Cereți administratorului un link nou.', iv2_errCancelled:'Linkul a fost anulat de administrator.', iv2_errEmailExists:'Există deja un cont cu acest e-mail. Autentificați-vă cu el sau folosiți alt e-mail.', iv2_errEmail:'Introduceți o adresă de e-mail validă.', iv2_errPassword:'Parola trebuie să aibă cel puțin 8 caractere.', iv2_errName:'Introduceți numele (cel puțin 2 caractere).', iv2_errMismatch:'Parolele nu coincid.', iv2_errServer:'Eroare la server. Încercați din nou peste câteva minute.', iv2_creating:'Se creează contul…', iv2_done:'Contul a fost creat. Se intră în registru…', iv2_doneLogin:'Contul a fost creat. Autentificați-vă cu e-mailul și parola alese.', st_inv_title:'Linkuri de înregistrare', st_inv_sub:'Generați un link de unică folosință și trimiteți-l persoanei: își alege numele, e-mailul și parola și primește contul cu rolul ales. Linkul funcționează o singură dată și expiră după perioada aleasă.', st_inv_rol:'Rol', st_inv_rolAsistent:'Asistent (vede registrul, completează loturi)', st_inv_rolAdmin:'Administrator (acces complet)', st_inv_rolAsistentScurt:'Asistent', st_inv_rolAdminScurt:'Administrator', st_inv_limba:'Limba paginii', st_inv_zile:'Valabil', st_inv_btn:'Generează link', st_inv_copy:'Copiază', st_inv_copied:'Copiat ✓', st_inv_once:'Copiați linkul acum: din motive de securitate nu mai poate fi afișat după ce părăsiți pagina. Dacă îl pierdeți, anulați-l și generați altul.', st_inv_thCreat:'Creat', st_inv_thExpira:'Expiră', st_inv_thCont:'Cont creat', st_inv_activa:'activ', st_inv_folosita:'folosit', st_inv_expirata:'expirat', st_inv_anulata:'anulat', st_inv_anuleaza:'Anulează', st_inv_none:'Niciun link generat încă.', st_inv_confirmAdmin:'Linkul va crea un cont de ADMINISTRATOR cu acces complet (plăți, setări, corecții). Continuați?', st_inv_confirmAnulare:'Anulați acest link? Nu va mai putea fi folosit.',
  au_emailPh:'nume@exemplu.com', au_passPh:'••••••••',
  au_modeAdmin:'Administrator', au_modeLocatie:'Locație', au_pin:'Cod PIN', au_pinPh:'••••••',
  au_pinNeed:'Introduceți codul PIN.', au_pinWrong:'PIN incorect.',
  au_pinRateLimited:'Prea multe încercări greșite. Reîncercați peste 15 minute.',
  au_pinNotTrusted:'Acest calculator nu este autorizat pentru contul de locație.',
  au_pinNotTrustedHint:'Comunicați acest cod unui administrator pentru a autoriza acest calculator:',
  au_pinServerError:'Eroare de conexiune. Încercați din nou.',

  st_trustedIps:'Locații de încredere', st_trustedIpsSub:'Doar calculatoarele cu aceste adrese IP pot folosi contul de locație.',
  st_ipAddr:'Adresă IP', st_ipAddrPh:'ex. 84.20.13.5', st_ipEticheta:'Etichetă (opțional)', st_ipEtichetaPh:'ex. Calculator recepție',
  st_ipAdauga:'+ Adaugă', st_ipNone:'Nicio adresă autorizată încă.', st_ipAdaugat:'adăugat',
  st_pinLocatie:'PIN cont locație', st_pinLocatieSub:'Codul folosit de manageri pentru a se conecta la contul comun de locație.',
  st_pinNou:'PIN nou', st_pinSchimba:'Schimbă PIN-ul', st_pinSchimbat:'PIN-ul a fost schimbat.',
  st_pinTooShort:'PIN-ul trebuie să aibă cel puțin 4 caractere.',

  nav_dashboard:'Tablou de bord', nav_participanti:'Participanți', nav_intarzieri:'Întârzieri',
  nav_vestimentatie:'Vestimentație', nav_serviciu:'Serviciu administratori', nav_spalatorie:'Spălătorie',
  nav_hostel:'Hostel', nav_lenjerie:'Lenjerie', nav_medical:'Medical', nav_daune:'Daune și recuperări', nav_fairplay:'Fair Play',
  nav_arbitraj:'Arbitraj', nav_antrenamente:'Antrenamente', nav_inventar:'Inventar', nav_sarcini:'Sarcini', nav_observatii:'Observații',
  nav_pauzatehnica:'Pauză tehnică', nav_rapoarte:'Rapoarte', nav_setari:'Setări',
  sb_sub:'Registru · BSKT Cup', sb_shift:'Schimb curent', hdr_logout:'Ieșire',

  th_cont:'Cont', th_data:'Data', th_actiune:'Acțiune', th_participant:'Participant', th_stare:'Stare',
  ac_participantPh:'Caută după nume...', ac_noResults:'Niciun rezultat',
  th_administrator:'Administrator', th_categorie:'Categorie', th_descriere:'Descriere', th_statut:'Statut',
  btn_add:'+ Adaugă', btn_delete:'Șterge', btn_cancel:'Anulează', btn_save:'Salvează modificările',
  btn_saving:'Se salvează…', empty_dash:'—',

  da_title:'Tablou de bord', da_stat_activi:'Participanți activi', da_stat_medical:'Avize medicale',
  da_stat_stoc:'Articole sub stoc minim', da_stat_sarcini:'Sarcini nesoluționate >48h',
  da_stat_hostel:'Cazați hostel (azi)', da_alerts_title:'Alerte automate',
  da_alerts_empty:'Nicio alertă activă în acest moment.', da_jurnal_title:'Jurnal activitate — ultimele acțiuni',
  da_total_inreg:'total înregistrați', da_expira30:'expiră', da_din:'din', da_categorii:'categorii',
  da_total_lucru:'total în lucru', da_total_inregistrari:'total înregistrări',
  sh_startTitle:'Începe schimbul de locație', sh_startSub:'Pornește schimbul pentru a debloca registrul și lista clară de activități pentru ziua de azi.',
  sh_startBtn:'Începe schimbul', sh_chooseName:'Cine este de serviciu?', sh_confirmStart:'Confirmă și începe',
  sh_active:'Schimb activ', sh_demo:'Mod demonstrativ pentru administrator', sh_stop:'Oprește schimbul',
  sh_refTitle:'Arbitri pentru astăzi', sh_refHelp:'Salvează numele și sala acum. Numărul mingilor poate fi completat aici mai târziu.',
  sh_referee:'Arbitru', sh_venue:'Sală', sh_saveRef:'Salvează', sh_saved:'salvat', sh_balls:'Mingi',
  sh_updateBalls_old:'Actualizează', sh_correctRef:'Corectează', sh_saveCorrection:'Salvează corectarea', sh_cancelCorrection:'Renunță', sh_correcting:'în corectare',
  sh_correctionError:'Corectarea nu a putut fi salvată.', sh_inventoryTitle:'Intrări inventar', sh_inventoryHelp:'Înregistrează imediat marfa sau echipamentul primit astăzi.',
  sh_item:'Articol', sh_quantity:'Cantitate', sh_addStock:'Adaugă în stoc',
  sh_trainingTitle:'Antrenamente programate azi', sh_trainingHelp:'Adaugă antrenorul, sportivul și ora; înregistrarea apare automat în Antrenamente.',
  sh_trainer:'Antrenor', sh_trainee:'Sportiv', sh_time:'Ora', sh_addTraining:'Salvează antrenamentul',
  sh_addRow:'+ Alt antrenament', sh_noEligible:'Nu există sportivi eligibili pentru antrenament.',
  sh_startError:'Schimbul nu a putut fi pornit.', sh_stopError:'Schimbul nu a putut fi oprit.',
  sh_stopAlreadyEnded:'Acest schimb fusese deja încheiat (probabil dintr-un alt tab sau dispozitiv). Pagina a fost actualizată.',
  sh_reportRequired:'Schimbul nu poate fi încheiat înainte de generarea raportului de schimb. Generați și salvați raportul, apoi încercați din nou.',
  sh_reportCheckError:'Nu s-a putut verifica raportul de schimb. Schimbul rămâne deschis. Încercați din nou.',
  sh_reportFinalizeError:'Raportul final nu a putut fi actualizat. Schimbul rămâne deschis și datele nu se pierd.',
  app_updateRequired:'A fost publicată o versiune nouă a registrului. Pagina se va reîncărca acum; apoi repetați acțiunea.',
  refresh_reminderTitle:'Mențineți registrul actualizat',
  refresh_reminderText:'Reîmprospătați pagina din când în când pentru ca registrul să funcționeze corect și să afișeze datele recente.',
  refresh_updateTitle:'Actualizare disponibilă',
  refresh_updateText:'Este disponibilă o versiune nouă. Reîmprospătați pagina înainte de generarea raportului sau încheierea schimbului.',
  refresh_verifyTitle:'Versiunea nu poate fi verificată',
  refresh_verifyText:'Schimbul rămâne deschis și datele sunt în siguranță. Verificați conexiunea și încercați din nou.',
  refresh_now:'Reîmprospătează', refresh_close:'Închide',
  sh_stopConfirm:'Sigur doriți să opriți schimbul? După confirmare, registrul va fi blocat și va trebui început un schimb nou pentru a putea edita din nou.',
  sh_locked:'Registrul este blocat. Începeți un schimb din Tablou de bord.',

  pa_title:'Participanți', pa_sub:'Date generale ale sportivilor înregistrați la locație.',
  pa_addTitle:'Adăugare participant nou', pa_dulap:'Nr. dulap', pa_dulapPh:'ex. 118', pa_nume:'Nume', pa_prenume:'Prenume',
  pa_nastere:'Data nașterii', pa_telefon:'Telefon', pa_telefonPh:'+373 6XXXXXXX', pa_email:'E-mail', pa_emailPh:'nume@mail.md',
  pa_adresa:'Adresa domiciliului', pa_adresaPh:'mun. Chișinău, str. ...', pa_aviz:'Data avizului medical',
  pa_marime:'Mărime vestimentație', pa_btnAdd:'+ Adaugă participant', pa_searchPh:'Caută după nume, telefon sau nr. dulap...',
  pa_th_dulap:'Dulap', pa_th_naștere:'Naștere', pa_th_avizMed:'Aviz medical', pa_th_marime:'Mărime',
  pa_categorieSp:'Categorie sportivă', pa_th_categorieSp:'Categorie',
  pa_sortare:'Sortare', pa_sortNume:'Nume (A-Z)', pa_sortStatut:'Statut (activ/inactiv)', pa_sortCategorie:'Filtrează după categorie',
  pa_inactivPrimii:'Inactivi primii', pa_inactivUltimii:'Inactivi ultimii',
  pa_toateCategoriile:'Toate categoriile', pa_faraCategorie:'Fără categorie',
  pa_none:'Niciun participant găsit.', pa_countSuffix:'participanți',
  pa_needNumePrenume:'Completați cel puțin nume și prenume.',
  pa_editTitle:'Modifică datele participantului', pa_editBtn:'Editează datele', pa_nespecificata:'Nespecificată',
  pa_deleteBtn:'Șterge participant', pa_deleteTitle:'Șterge participantul din registru',
  pa_deleteConfirm:(nume)=>`Ștergeți definitiv participantul ${nume}? Se vor șterge și toate înregistrările asociate (întârzieri, vestimentație, spălătorie, lenjerie, hostel, daune, observații). Această acțiune nu poate fi anulată.`,
  pa_needNumePrenume2:'Numele și prenumele sunt obligatorii.',
  pa_fisa:'Fișă participant', pa_statut:'Statut', pa_faraAviz:'fără aviz înregistrat',
  pa_expiraLa:'zile', pa_k_intarzieri:'Întârzieri', pa_k_vestimentatie:'Vestimentație primită', pa_k_cazari:'Cazări hostel',
  pa_k_lenjerie:'Lenjerie', pa_k_daune:'Daune provocate', pa_k_observatii:'Observații', pa_fara_inreg:'Fără înregistrări.',
  pa_k_antrenamente:'Antrenamente',
  pa_intarziere_word:'Întârziere', pa_cazare_word:'Cazare', pa_eliberat_returnat:'Eliberat → returnat',
  pa_nereturnat:'nereturnat',

  it_title:'Întârzieri', it_sub:'Evidența întârzierilor sportivilor la locație, cu statistici automate.',
  it_totalInreg:'Total înregistrate', it_lunaCurenta:'Luna curentă', it_frecventi:'Participanți frecvenți (≥3/30 zile)',
  it_addTitle:'Înregistrare întârziere', it_topTitle:'Participanți cu cele mai multe întârzieri (30 zile)',
  it_nrIntarzieri:'Nr. întârzieri', it_allTitle:'Toate întârzierile', it_none:'Nicio întârziere înregistrată.',
  it_minute:'Minute', it_motiv:'Motiv',

  ve_title:'Vestimentație', ve_sub:'Eliberări de vestimentație către sportivi — scade automat din inventar.',
  ve_addTitle:'Eliberare vestimentație', ve_tip:'Tip articol', ve_marime:'Mărime', ve_cantitate:'Cantitate',
  ve_data:'Data', ve_btnAdd:'+ Eliberează', ve_th_tip:'Tip', ve_th_cantitate:'Cantitate', ve_th_returnare:'Returnare',
  ve_countSuffix:'eliberări', ve_none:'Nicio eliberare înregistrată.',
  ve_hint:'Apasă pe statut pentru a marca returnarea',
  ve_confirmReturn:'Confirmați marcarea vestimentației ca returnată? Odată confirmată, doar administratorii mai pot anula acest lucru.',
  ve_lockedHint:'Returnare confirmată — doar administratorii pot anula.',

  se_title:'Serviciu administratori', se_sub:'Graficul de serviciu / schimburile administratorilor la locație.',
  se_overlap:'Suprapunere de schimburi detectată pe:', se_addTitle:'Adăugare schimb',
  se_raportTitle:'Raport schimburi lucrate', se_nrSchimburi:'Nr. schimburi', se_calendarTitle:'Calendar schimburi',
  se_startTime:'Început', se_endTime:'Sfârșit',
  se_filterMonth:'Schimbă luna', se_month:'Lună', se_allMonths:'Toate lunile',
  se_none:'Niciun schimb înregistrat.',

  sp_title:'Spălătorie', sp_sub:'Evidența spălătoriilor chimice și a sumelor de plată.',
  sp_totalChelt:'Total cheltuieli spălătorie', sp_operatiuni:'operațiuni', sp_addTitle:'Predare la spălătorie',
  sp_tipArt:'Tip articole', sp_tipArtPh:'ex. Maiou, șort', sp_dataPredarii:'Data predării', sp_suma:'Sumă (MDL)',
  sp_th_articole:'Articole', sp_th_suma:'Sumă', sp_countSuffix:'înregistrări', sp_none:'Nicio înregistrare.',
  sp_cantitate:'Cantitate', sp_th_cantitate:'Cant.', sp_locatia:'Locația (fără participant)',
  sp_th_returnare:'Data returnării', sp_hint:'Apasă pe statut pentru a marca returnarea',
  sp_confirmReturn:'Confirmați marcarea articolelor ca returnate de la spălătorie? Odată confirmată, doar administratorii mai pot anula acest lucru.',
  sp_lockedHint:'Returnare confirmată — doar administratorii pot anula.',
  sp_filtruTitle:'Schimbă luna', sp_luna:'Lună', sp_toatePerioadele:'Toate lunile',
  sp_btnRaport:'⇩ Raport lunar (PDF)', sp_raportTitlu:'Raport spălătorie',
  sp_raportPerioada:'Perioada', sp_raportToate:'Toate lunile', sp_raportNimic:'Nicio înregistrare de spălătorie în perioada selectată.',
  sp_raportTh_nr:'Nr.', sp_raportTh_beneficiar:'Participant / locație', sp_raportTh_operatiuni:'Operațiuni',
  sp_raportTh_articole:'Articole', sp_raportTh_total:'Total',
  sp_raportTotalGeneral:'TOTAL GENERAL', sp_raportBeneficiari:'Beneficiari', sp_raportGenerat:'Generat la',

  ho_title:'Hostel', ho_sub:'Cazările pe noapte ale sportivilor la locație.', ho_cazatiAzi:'Cazați azi',
  ho_totalNopti:'Total nopți înregistrate', ho_addTitle:'Înregistrare cazare', ho_dataCazarii:'Data cazării',
  ho_observatii:'Observații', ho_observatiiPh:'ex. Cameră 2', ho_noptiTitle:'Nopți per participant',
  ho_nrNopti:'Nr. nopți', ho_faraDate:'Fără date.', ho_toateCazarile:'Toate cazările', ho_th_observatii:'Observații',
  ho_none:'Nicio cazare.',
  ho_cazatiActivAcum:'Cazați activ acum', ho_th_statut:'Statut', ho_statutHint:'Apasă pe statut pentru a marca închiderea cazării',

  le_title:'Lenjerie', le_sub:'Evidența lenjeriei de hostel eliberate sportivilor.', le_addTitle:'Eliberare lenjerie',
  le_dataElib:'Data eliberării', le_countSuffix:'înregistrări', le_hint:'Apasă pe statut pentru a marca returnarea',
  le_stockSource:'Sursă stoc', le_stockNew:'Nou', le_stockUsed:'Uzat', le_available:'disponibile',
  le_th_source:'Sursă', le_th_eliberare:'Eliberare', le_th_returnare:'Returnare', le_none:'Nicio înregistrare.',
  le_noStockNew:'Nu mai există lenjerie nouă în stoc. Alegeți manual „Uzat” dacă doriți să eliberați din stocul uzat.',
  le_noStockUsed:'Nu mai există lenjerie uzată în stoc. Alegeți manual „Nou” dacă doriți să eliberați din stocul nou.',
  le_confirmReturn:'Confirmați marcarea lenjeriei ca returnată? Odată confirmată, doar administratorii mai pot anula acest lucru.',
  le_lockedHint:'Returnare confirmată — doar administratorii pot anula.',

  me_title:'Medical', me_sub:'Avize medicale, ordonate crescător după numărul zilelor rămase. Valabilitate: 6 luni.',
  me_expirate:'Expirate', me_expira30:'Expiră < 30 zile', me_valabile:'Valabile', me_faraAviz:'Activi fără aviz medical',
  me_tableTitle:'Avize medicale — toți participanții activi', me_th_dataAvizului:'Data avizului',
  me_th_dataExpirarii:'Data expirării', me_th_zileRamase:'Zile rămase', me_none:'Fără participanți activi.',

  da2_title:'Daune și recuperări', da2_sub:'Evidența daunelor aduse locației (inventar afectat/distrus).',
  da2_addTitle:'Înregistrare daună', da2_inventarAfectat:'Inventar afectat', da2_inventarAfectatPh:'ex. Masă tenis nr.1',
  da2_natura:'Natura deteriorării', da2_naturaPh:'ex. Fisură blat', da2_stareBun:'Stare bun',
  da2_teren:'Teren', da2_th_teren:'Teren',
  da2_th_inventarAfectat:'Inventar afectat', da2_th_natura:'Natura', da2_countSuffix:'daune înregistrate',
  da2_none:'Nicio daună înregistrată.', da2_valoare:'Prejudiciu estimat (MDL)', da2_avertizor:'Nume avertizor',
  da2_observatii:'Observații', da2_afectat:'afectat', da2_deteriorat:'deteriorat',
  da2_totalValoare:'Prejudiciu estimat total', da2_totalAfectate:'Bunuri afectate', da2_totalDeteriorate:'Bunuri deteriorate',
  da2_filterMonth:'Perioada raportului', da2_month:'Lună', da2_sixMonths:'6 luni', da2_year:'An',
  da2_endMonth:'Luna de sfârșit', da2_reportTitle:'Raport daune provocate — după număr',
  da2_reportSub:'Clasament după numărul daunelor provocate, indiferent de valoarea lor.',
  da2_reportCount:'Nr. daune', da2_reportNone:'Nicio daună în perioada selectată.',

  fp_title:'Fair Play', fp_sub:'Evidența cartonașelor galbene și roșii acordate sportivilor.',
  fp_addTitle:'Înregistrare sancțiune', fp_numeSportiv:'Nume sportiv', fp_platou:'Platoul de joc',
  fp_descriere:'Descrierea faptei', fp_descrierePh:'ex. Comportament nesportiv față de arbitru',
  fp_cartonas:'Cartonaș', fp_galben:'galben', fp_rosu:'roșu', fp_ora:'Ora (opțional)',
  fp_th_ora:'Ora', fp_th_platou:'Platou', fp_th_descriere:'Descriere', fp_th_cartonas:'Cartonaș',
  fp_countSuffix:'sancțiuni înregistrate', fp_none:'Nicio sancțiune înregistrată.',
  fp_totalSanctiuni:'Total sancțiuni', fp_totalGalbene:'Cartonașe galbene', fp_totalRosii:'Cartonașe roșii',
  fp_filterMonth:'Perioada raportului', fp_month:'Lună', fp_sixMonths:'6 luni', fp_year:'An',
  fp_endMonth:'Luna de sfârșit', fp_reportTitle:'Clasament cartonașe — după număr',
  fp_reportSub:'Clasament sportivilor după numărul de cartonașe primite.',
  fp_reportGalbene:'Galbene', fp_reportRosii:'Roșii', fp_reportTotal:'Total',
  fp_reportNone:'Nicio sancțiune în perioada selectată.', fp_needSportiv:'Selectați sportivul.',

  ar_title:'Arbitraj', ar_sub:'Arbitrii de turneu și cantitatea de mingi noi eliberate — scade automat din inventar.',
  ar_addTitle:'Eliberare mingi arbitru', ar_numeArbitru:'Nume arbitru', ar_numeArbitruPh:'Nume arbitru',
  ar_turneu:'Turneu', ar_mingiNoi:'Mingi noi', ar_th_arbitru:'Arbitru', ar_th_turneu:'Turneu', ar_th_mingiNoi:'Mingi noi',
  ar_marcaMingi:'Marcă', ar_th_marcaMingi:'Marcă',
  ar_countSuffix:'eliberări', ar_none:'Nicio eliberare.', ar_needNume:'Introduceți numele arbitrului.',
  arb_title:'Registru arbitri', arb_sub:'Arbitrii disponibili pentru turnee — gestionați lista aici.',
  arb_addTitle:'Adăugare arbitru nou', arb_btnAdd:'+ Adaugă arbitru', arb_countSuffix:'arbitri', arb_none:'Niciun arbitru înregistrat.',
  arb_fisa:'Fișă arbitru', arb_editTitle:'Modifică datele arbitrului', arb_editBtn:'Editează datele',
  arb_deleteBtn:'Șterge arbitru', arb_deleteTitle:'Șterge arbitrul din registru',
  arb_deleteConfirm:(nume)=>`Ștergeți definitiv arbitrul ${nume}? Această acțiune nu poate fi anulată.`,

  an_title:'Antrenamente', an_sub:'Sesiuni de antrenament individual — 100 MDL/sesiune de la jucător, 200 MDL/sesiune pentru antrenor.',
  an_totalSesiuni:'Sesiuni totale', an_totalIncasat:'Sumă jucători', an_sumarAntrenori:'Sumar pe antrenor',
  an_addTitle:'Înregistrare antrenament', an_jucator:'Jucător', an_antrenor:'Antrenor', an_ora:'Ora (opțional)',
  an_btnAdd:'+ Înregistrează', an_th_jucator:'Jucător', an_th_antrenor:'Antrenor', an_th_ora:'Ora',
  an_th_sumaJucator:'Sumă jucător', an_th_sumaAntrenor:'Sumă antrenor', an_countSuffix:'sesiuni', an_none:'Nicio sesiune înregistrată.',
  an_eligibiliTitle:'Jucători eligibili pentru antrenament', an_eligibiliSub:'Doar acești jucători apar în formularul de mai sus. Alegeți din toți participanții.',
  an_adaugaEligibil:'Adaugă jucător eligibil', an_eligibilAdaugat:'+ Adaugă', an_eligibilNone:'Niciun jucător eligibil încă.',
  an_needJucator:'Selectați un jucător eligibil.', an_neeligibil:'Acest jucător nu este marcat eligibil pentru antrenament.',
  an_perioada:'Filtrează după lună', an_luna:'Lună', an_toateLunile:'Toate lunile',
  an_btnRaportJucatori:'⇩ Raport pe jucători (PDF)', an_raportTitlu:'Raport antrenamente pe jucători',
  an_raportPerioada:'Perioada', an_raportToate:'Toate lunile', an_raportNimic:'Nicio sesiune de antrenament în perioada selectată.',
  an_raportTh_nr:'Nr.', an_raportTh_jucator:'Jucător', an_raportTh_sesiuni:'Sesiuni', an_raportTh_total:'Total achitat',
  an_raportTotalGeneral:'TOTAL GENERAL', an_raportJucatoriDistincti:'Jucători', an_raportGenerat:'Generat la',

  iv_title:'Inventar', iv_sub:'Stocul bunurilor aflate la locație. Cantitatea curentă scade automat la eliberări.',
  iv_lowStock:'articole sub stocul minim admis.', iv_addTitle:'Intrare / corectare stoc', iv_articol:'Articol',
  iv_tipMiscare:'Tip mișcare', iv_intrare:'intrare', iv_iesire:'ieșire', iv_corectare:'corecție', iv_coloana:'Coloană corectată', iv_btnAdd:'+ Înregistrează',
  iv_structTitle:'Structura inventarului', iv_th_articol:'Articol', iv_th_culoare:'Culoare', iv_th_marime:'Mărime',
  iv_uzateTitle:'Uzate', iv_uzateSub:'Bunuri scoase din stocul nou și folosite ca uzate (maiouri, șorturi, lenjerie).',
  iv_th_um:'UM', iv_th_initial:'Inițial', iv_th_intrari:'Intrări', iv_th_iesiri:'Ieșiri', iv_th_curent:'Curent',
  iv_th_minim:'Minim', iv_th_stare:'Stare',

  ta_title:'Sarcini', ta_sub:'Sarcini și probleme nesoluționate. Sistemul semnalează cele restante >48 ore.',
  ta_total:'Total sarcini', ta_nesolutionate:'Nesoluționate', ta_restante:'Restante >48h',
  ta_addTitle:'Înregistrare sarcină', ta_descriere:'Descriere problemă', ta_descrierePh:'ex. Bec ars în vestiar',
  ta_th_inregDe:'Înregistrat de', ta_th_status:'Status', ta_th_solDe:'Soluționat de', ta_countSuffix:'sarcini',
  ta_filterAll:'Toate', ta_filterOpen:'Nesoluționate', ta_filterSolved:'Soluționate',
  ta_none:'Nicio sarcină înregistrată.', ta_needDesc:'Descrieți sarcina.',
  ta_st_nesolutionat:'nesoluționat', ta_st_inLucru:'în lucru', ta_st_solutionat:'soluționat',

  ob_title:'Observații', ob_sub:'Situații scurte despre participanți sau despre locație și activitatea zilnică.',
  ob_addTitle:'Înregistrare observație', ob_targetType:'Observația se referă la', ob_targetParticipant:'Participant', ob_targetGeneral:'Situație generală',
  ob_target:'Participant / Subiect', ob_subject:'Subiect', ob_subjectPh:'ex. Locație, curățenie, vestiar...', ob_categorie:'Categorie', ob_descScurta:'Descriere scurtă',
  ob_descScurtaPh:'detalii...', ob_countSuffix:'observații', ob_none:'Nicio observație.', ob_needParticipant:'Selectați participantul.', ob_needSubject:'Introduceți subiectul situației.',

  pt_title:'Pauză tehnică', pt_sub:'Evidența întârzierilor la începutul meciurilor — intervalul pauzei, terenul și motivul.',
  pt_addTitle:'Înregistrare pauză tehnică', pt_oraStart:'De la ora', pt_oraStop:'Până la ora', pt_teren:'Teren',
  pt_descriere:'Ce s-a întâmplat', pt_descrierePh:'ex. Plasă ruptă, schimbată în 15 min.',
  pt_th_interval:'Interval', pt_th_durata:'Durată', pt_th_teren:'Teren', pt_th_descriere:'Descriere',
  pt_countSuffix:'pauze înregistrate', pt_none:'Nicio pauză tehnică înregistrată.',
  pt_needOre:'Completați ora de început și ora de sfârșit.', pt_needDescriere:'Descrieți motivul pauzei tehnice.',
  pt_totalPauze:'Pauze (30 zile)', pt_totalMinute:'Minute pierdute (30 zile)', pt_medie:'Durată medie',
  pt_minSuffix:'min', pt_showing:(n,total)=>`Cele mai recente ${n} din ${total}`,

  re_title:'Rapoarte și statistici', re_sub:'Generare rapoarte pentru orice perioadă. Export: Excel, PDF, imprimare.',
  re_perioada:'Perioadă raport', re_de_la:'De la', re_pana_la:'Până la', re_excel:'Excel', re_pdf:'PDF',
  act_sectionTitle:'Rapoarte de schimb', act_sectionSub:'Rapoartele generate la închiderea fiecărui schimb.',
  act_pastTitle:'Generează raport pentru un schimb anterior', act_pastLoad:'Încarcă schimburile', act_pastPick:'Schimb',
  act_pastNone:'Niciun schimb încheiat găsit.', act_pastAlready:'(raport deja generat)',
  act_none:'Niciun raport de schimb generat încă.', act_btnGenerate:'Generează raportul', act_generating:'Se generează…',
  act_docTitle:'Raport de schimb', act_perioada:'Perioada',
  act_s_admin:'Admin', act_s_intarzieri:'Întârzieri', act_s_arbitraj:'Arbitraj', act_s_fairplay:'Fair Play',
  act_s_daune:'Daune', act_s_inventar:'Inventar', act_s_hostel:'Hostel', act_s_treninguri:'Trening', act_s_sarcini:'Sarcini', act_s_observatii:'Observații',
  act_s_pauzatehnica:'Pauză tehnică', act_teren:'Teren', act_interval:'Interval', act_durata:'Durată',
  act_conditie:'Condiție',
  act_dataSchimb:'Data schimb', act_numeAdmin:'Nume administrator',
  act_numeSportiv:'Nume sportiv', act_min:'Min', act_motiv:'Motiv',
  act_numeArbitru:'Nume arbitru', act_cartonas:'Cartonaș', act_descriere:'Descriere', act_platou:'Platou',
  act_tipMiscare:'Intrare/Ieșire', act_articol:'Articol', act_cantitate:'Cantitate', act_sursa:'Nume participant/furnizor',
  act_camera:'Cameră', act_oraCazarii:'Ora cazării', act_statut:'Statut',
  act_antrenor:'Antrenor', act_data:'Data', act_ora:'Ora', act_programat:'Programat', act_desfasurat:'Desfășurat', act_da:'DA', act_nu:'NU',
  act_goale:'—', act_noEntries:'fără înregistrări', act_generat:'Raport de schimb generat și salvat în Rapoarte.', act_needShift:'Nu există un schimb activ.',
  re_print:'Imprimare', re_sect_participanti:'Rapoarte privind participanții', re_sect_admin:'Rapoarte administrative',
  re_sect_fin:'Rapoarte financiare', re_sect_inv:'Rapoarte de inventar',
  re_r_intarzieri:'Întârzieri înregistrate', re_r_obsAbs:'Observații / absențe', re_r_cazariHostel:'Cazări hostel',
  re_r_vestElib:'Vestimentație eliberată', re_r_avizeExp:'Avize medicale expirate', re_r_dauneProv:'Daune provocate',
  re_r_schimburi:'Schimburi programate', re_r_sarciniInreg:'Sarcini înregistrate', re_r_sarciniSol:'Sarcini soluționate',
  re_r_cheltSpal:'Cheltuieli spălătorie', re_noExcel:'Modulul Excel nu s-a încărcat. Verificați conexiunea la internet și reîncărcați pagina.',
  re_noPdf:'Modulul PDF nu s-a încărcat. Verificați conexiunea la internet și reîncărcați pagina.',
  re_popupBlocked:'Browserul a blocat fereastra de imprimare. Permiteți ferestrele pop-up pentru acest fișier.',
  re_tipRaport:'Tip raport', re_type_total:'Raport complet', re_type_intarzieri:'Întârzieri',
  re_type_spalatorie:'Spălătorie', re_type_medical:'Medical', re_type_daune:'Daune și recuperări',
  re_type_arbitraj:'Arbitraj', re_type_antrenamente:'Antrenamente', re_type_inventar:'Inventar',
  re_sect_intarzieri:'Rapoarte întârzieri', re_sect_spalatorie:'Rapoarte spălătorie', re_sect_medical:'Rapoarte medicale',
  re_sect_daune:'Rapoarte daune și recuperări', re_sect_arbitraj:'Rapoarte arbitraj', re_sect_antrenamente:'Rapoarte antrenamente',
  re_m_totalSesiuniAntrenament:'Total sesiuni antrenament', re_m_incasatAntrenament:'Încasat de la jucători',
  re_m_totalIntarzieri:'Total întârzieri', re_m_totalMinute:'Total minute întârziere', re_m_frecventi:'Participanți frecvenți (≥3/30 zile)',
  re_m_operatiuniSpal:'Operațiuni spălătorie', re_m_cantitateArt:'Cantitate articole', re_m_cheltuieliTotale:'Cheltuieli totale',
  re_m_spalReturnate:'Returnate de la spălătorie', re_m_spalNereturnate:'Nereturnate de la spălătorie',
  re_m_aviziPerioada:'Avize în perioadă', re_m_valabile:'Valabile', re_m_expiraCurand:'Expiră curând', re_m_expirate:'Expirate',
  re_m_totalDaune:'Total daune înregistrate', re_m_eliberariArb:'Eliberări înregistrate',
  re_m_mingiDhs:'Mingi DHS eliberate', re_m_mingiJoola:'Mingi JOOLA eliberate',

  st_title:'Setări', st_sub:'Administratori, praguri de alertă și jurnal complet de activitate.',
  st_admins:'Administratori', st_rol:'Rol', st_rolValue:'Administrator locație', st_activAcum:'activ acum',
  st_rolLocatieCont:'Cont comun de locație',
  as_cDeRezolvat:'De rezolvat', as_urgente:'urgente', as_nimicUrgent:'nimic urgent', as_cFaraLot:'Meciuri fără lot', as_cFaraLotSub:'ultimele 60 de zile · jucători neplătiți', as_cBrutSapt:'Brut necesar săptămâna aceasta', as_dinLuni:'de luni', as_faraLotScurt:'fără lot',
  as_deRezolvatTitlu:'De rezolvat', as_seIncarca:'se încarcă…', as_totInRegula:'Totul este în regulă — nimic de rezolvat.',
  as_t_lineup:'Lot', as_t_match:'Meci', as_t_sync:'Rezultate', as_t_referee:'Arbitraj', as_t_medical:'Medical', as_t_team:'Echipă', as_t_fairplay:'Fair play', as_t_late:'Întârzieri', as_t_kit:'Returnare', as_t_inventory:'Inventar', as_t_task:'Sarcină',
  as_pLot:(d,n)=>`${d}: ${n} ${plural(n,'mt_meciuriSuffix','ro')} jucate fără lot — jucătorii nu sunt plătiți până la completare.`,
  as_pFaraScor:(n,d)=>`${n} ${plural(n,'mt_meciuriSuffix','ro')} din zilele trecute nu au scor (ultimul: ${d}).`,
  as_pSyncEroare:(w,e)=>`Ultima sincronizare a rezultatelor (${w}) a eșuat${e?': '+e:''}.`,
  as_pSyncVechi:(w)=>`Rezultatele nu s-au mai sincronizat de la ${w} — verificați dacă sincronizarea automată funcționează.`,
  as_pSyncIgnorate:(n)=>`Ultima sincronizare a ignorat ${n} ${plural(n,'mt_meciuriSuffix','ro')}: echipe de pe site nelegate de o echipă din registru.`,
  as_pSyncNiciodata:'Rezultatele nu au fost sincronizate niciodată.',
  as_pPeste2:(d,n)=>`${d}: peste doi arbitri (${n}).`,
  as_pOreLipsa:(d,n)=>`${d}: arbitraj fără ore completate (${n}) — se plătește 0 până la completare.`,
  as_pAvizExpirat:(n,l)=>`${n} ${n===1?'aviz medical expirat':'avize medicale expirate'}: ${l}.`,
  as_pAvizCurand:(n,l)=>`${n} ${n===1?'aviz medical expiră':'avize medicale expiră'} în 30 de zile: ${l}.`,
  as_pEchipaMica:(e,n)=>`${e}: doar ${n} ${n===1?'jucător activ':'jucători activi'} în echipă (minim 3 pe teren).`,
  as_pFaraEchipa:(n,l)=>`${n} ${n===1?'jucător activ':'jucători activi'} fără echipă: ${l}.`,
  as_pFairPlay:(p,tip,d)=>`${p}: ${tip} (${d}).`,
  as_pIntarzieri:(p,n)=>`${p}: ${n} întârzieri în ultimele 30 de zile.`,
  as_pVestimentatie:(n,l)=>`${n} ${n===1?'articol de vestimentație nereturnat':'articole de vestimentație nereturnate'}: ${l}.`,
  as_pSpalatorie:(n)=>`${n} ${n===1?'predare la spălătorie nereturnată':'predări la spălătorie nereturnate'} de peste 2 zile.`,
  as_pLenjerie:(n)=>`${n} ${n===1?'set de lenjerie nereturnat':'seturi de lenjerie nereturnate'} de peste 7 zile.`,
  as_pSarciniDeschise:(n)=>`${n} ${n===1?'sarcină deschisă':'sarcini deschise'}.`,
  ar2_regula:(ora,pct,brut)=>`Fiecare arbitru, singur sau în pereche: ${ora} lei net pe oră arbitrată. Compania plătește brut ${money(brut)} lei/oră (net ÷ (1 − ${pct}%)); arbitrul achită reținerea de ${pct}% și rămâne cu ${ora} lei/oră.`,
  ar2_net:(ora)=>`Net (${ora}/oră)`, ar2_retinere:(pct)=>`Reținere ${pct}%`, ar2_tOra:'Lei net pe oră (fiecare arbitru)',
  ar2_obsLipsa:(n)=>`${n} ${n===1?'zi':'zile'} fără ore completate`,
  ar2_avertOreLipsa:(n)=>`${n} ${n===1?'zi de arbitraj nu are':'zile de arbitraj nu au'} ora de început/sfârșit completată — se plătesc 0 până la completare (Arbitraj → Ore).`,
  ar2_hint:'Apăsați pe un arbitru pentru detaliile pe zile. Orele se completează în Arbitraj sau din tabloul de bord, la schimb.',
  fl_label:'Freelancer', fl_da:'Da', fl_nu:'Nu', fl_daLung:'Da — se plătește brutul (achită singur 15%)', fl_nuLung:'Nu — se plătește netul',
  fl_nuCalc:'Nu este freelancer: compania plătește netul (impozitul se achită pe altă cale).', fl_schimba:'Schimbă statutul de freelancer',
  fl_reviewTitlu:'Verificați statutul de freelancer',
  fl_explDa:'Freelancer: compania plătește suma brută (net ÷ 0,85); persoana achită 15% și rămâne cu netul.',
  fl_explNu:'Nu este freelancer: compania plătește doar netul; impozitul se achită pe altă cale.',
  as_impactPlata:'Impact asupra plăților (suma de plătit)',
  as_jucDatePersonale:'Fișa personală a jucătorului (naștere, adresă, act de identitate, IDNP, telefon, contacte și restul datelor personale) este vizibilă doar administratorilor.',
  as_arbInregistrat:'Înregistrat în registru', as_arbDatePersonale:'Datele personale ale arbitrului (naștere, adresă, act de identitate, telefon, aviz medical) sunt vizibile doar administratorilor.',
  as_paSub:'Jucătorii BSKT Cup — echipa, rezultatele și istoricul sportiv.', as_paSearchPh:'Caută după nume sau echipă…',
  as_rol:'Asistent (doar citire)', as_cont:'Cont asistent', as_readOnly:'Contul de asistent are doar drept de citire — modificarea nu a fost făcută.',
  as_dashSub:'cont de asistent · doar citire', as_echipeActive:'echipe active', as_ultimaZi:'Ultima zi de joc',
  as_linkPlati:'Plăți pe jucători, echipe și arbitri; export Excel', as_linkStats:'Win rate, +/−, căpitani, clasament echipe', as_linkMeciuri:'Rezultate și loturi pe zile', as_linkJucatori:'Profiluri sportive și istoric',
  as_doarCitire:'Acest cont vede și exportă datele. Poate adăuga meciuri și completa loturile (din lunea săptămânii trecute încoace), poate modifica loturile echipelor și statutul, avizul medical și dulapul jucătorilor — fiecare salvare este verificată, înregistrată și poate fi anulată de administrator. Fișa personală nu este disponibilă.',
  as_fereastra:(a,b)=>`Contul de asistent poate adăuga și modifica meciuri din ${a} până la ${b}.`, as_inafaraFerestrei:(a,b)=>`Data este în afara perioadei permise (${a} – ${b}).`,
  as_teamNota:'Contul de asistent poate modifica doar lotul echipei (jucători, număr, căpitan/jucător). Denumirea, culoarea și statutul echipei rămân la administrator.',
  as_teamPlataNota:'Lotul echipei nu schimbă plățile meciurilor deja jucate; contează doar ca propunere pentru loturile meciurilor următoare.',
  as_profilNota:'Contul de asistent poate modifica statutul, data avizului medical, numărul dulapului și dacă jucătorul este freelancer.', as_avizInvalid:'Data avizului medical trebuie să fie din ultimul an, nu din viitor.',
  as_reviewMeciNou:'Verificați meciul nou', as_reviewMeci:'Verificați modificările meciului', as_reviewEchipa:'Verificați modificările lotului', as_reviewJucator:'Verificați modificările jucătorului',
  as_reviewNota:'Modificarea se salvează imediat, se înregistrează și poate fi anulată de administrator.', as_inapoi:'Înapoi la editare', as_confirma:'Confirm și salvez',
  as_chData:'Data', as_chEchipe:'Echipe', as_chDetalii:'Detalii (nr., teren, arbitru, observații sau OT)', as_nou:'nou', as_faraSchimbari:'Fără schimbări de lot.',
  as_faraScorPlata:'Meciul nu are încă scor — plata se calculează automat când apare scorul.', as_impactBrut:'Impact asupra plăților (brut)',
  as_logTitlu:'Modificările mele (ultimele 3 săptămâni)', as_logTitluAdmin:'Modificări făcute de asistent', as_logGol:'Nicio modificare în ultimele 3 săptămâni.',
  as_anulat:'anulat', as_anuleaza:'Anulează', as_confirmAnulare:(n)=>`Anulați această modificare a asistentului (${n} ${n===1?'înregistrare':'înregistrări'})? Datele revin la starea de dinainte.`,
  st_praguri:'Praguri de alertă (informativ)', st_p_medAlerta:'Aviz medical — alertă', st_p_medAlertaV:'≤ 7 zile rămase',
  st_p_medVal:'Aviz medical — valabilitate', st_p_medValV:'6 luni', st_p_sarciniRest:'Sarcini restante',
  st_p_sarciniRestV:'> 48 ore', st_p_intarzieri:'Întârzieri frecvente', st_p_intarzieriV:'≥ 3 în 30 zile',
  st_p_inactiv:'Participant inactiv', st_p_inactivV:'> 2 luni fără prezență',
  st_jurnalTitle:'Jurnal activitate — ultimele acțiuni',

  al_medExpired:(name)=>`Avizul medical al sportivului ${name} a expirat.`,
  al_medSoon:(name,days)=>`Avizul medical al sportivului ${name} expiră peste ${days} zile.`,
  al_medMissing:(name)=>`Sportivul activ ${name} nu are aviz medical înregistrat.`,
  al_lowStock:(name,qty,um,min)=>`Stocul „${name}” a scăzut la ${qty} ${um} (minim ${min}).`,
  al_staleTask:(desc)=>`Sarcina „${desc}” înregistrată mai mult de 48 ore în urmă nu a fost soluționată.`,
  al_openTask:(desc)=>`Sarcina „${desc}” este în așteptare.`,
  al_typeMedical:'Medical', al_typeInventory:'Inventar', al_typeTask:'Sarcină',
  al_frequentLate:(name,count)=>`Sportivul ${name} a întârziat de ${count} ori în ultimele 30 de zile.`,
  nav_statistici:'Statistici jucători',
},
ru: {
  au_sub:'Электронный журнал · BSKT Cup 3×3', au_email:'Эл. почта', au_pass:'Пароль', au_login:'Войти',
  au_loading:'Вход…', au_needBoth:'Введите эл. почту и пароль.', au_badCreds:'Неверная эл. почта или пароль.', au_noAccess:'У этой учётной записи нет доступа к реестру.', pl_saptamana:'Неделя', pl_blocata:'Заблокирована', pl_deschisa:'Открыта', pl_blocheaza:'Заблокировать', pl_deblocheaza:'Разблокировать', pl_confirmBlocare:(s)=>`Заблокировать неделю ${s}? После блокировки никто не сможет изменить её матчи, счёт и составы — ни вручную, ни из Google-таблицы, ни с сайта.`, pl_confirmDeblocare:(s)=>`ВНИМАНИЕ: неделя ${s} заблокирована. Разблокировка снова разрешит изменять её матчи, составы и выплаты (вручную, из таблицы и с сайта). Разблокировать?`, pl_blocataTitlu:'Неделя этого матча заблокирована. Разблокируйте её в разделе «Выплаты», чтобы вносить изменения.', al_typeSync:'Таблица', al_tabelNume:(n)=>`${n} имён из Google-таблицы ждут подтверждения (Настройки → Google-таблица). Составы с этими именами до тех пор не импортируются.`, tb_title:'Google-таблица (матчи, составы, рейтинг)', tb_sub:'Таблица — основной источник: результаты (лист Results), составы (листы PD_дд.мм.гггг), рейтинг и команда игроков (Player data). Сайт 3x3.bsktcup.com остаётся резервным. То, что вы меняете вручную в приложении, сохраняется — синхронизация не перезаписывает ручные изменения и не восстанавливает удалённые матчи. Заблокированные недели не меняются вообще.', tb_neconfigurat:'Таблица ещё не подключена — выполните шаги ниже.', tb_ultima:'Последняя синхронизация:', tb_niciodata:'Подключено, ещё не синхронизировано.', tb_meciuriTabel:'матчей в таблице', tb_conflicte:'ручных отличий сохранено', tb_loturiAsteapta:'составов ждут имён', tb_simuleaza:'Проверить (без изменений)', tb_conectare:'Подключение таблицы', tb_pas1:'В таблице: Расширения → Apps Script → <b>+ рядом с «Файлы» → Скрипт</b>, назовите его «bskt-registru-sync», вставьте скрипт в этот НОВЫЙ файл → Сохранить. <b>Не удаляйте и не меняйте уже существующие скрипты</b> (например, updatePlayerData).', tb_pas2:'Создайте секретный ключ и укажите его в Apps Script → Настройки проекта → Свойства скрипта: <b>CHEIE</b> = ключ ниже.', tb_pas3:'В Apps Script: Начать развёртывание → Новое развёртывание → Веб-приложение → Запуск от: Меня → Доступ: Все → Развернуть → разрешите доступ.', tb_pas4:'Скопируйте ссылку веб-приложения (…/exec) и сохраните её здесь:', tb_faraCheie:'ключ не создан', tb_arata:'Показать', tb_ascunde:'Скрыть', tb_genereazaCheie:'Создать ключ', tb_cheieNoua:'Новый ключ', tb_confirmCheieNoua:'Создать новый ключ? Старый перестанет работать: новый ключ нужно указать и в Apps Script (Свойства скрипта → CHEIE).', tb_numeTitlu:'Имена из таблицы для подтверждения', tb_numeSub:'Точно совпадающие имена связываются автоматически. Для остальных выберите игрока из реестра (предложение уже выбрано) или создайте нового. Выбор запоминается.', tb_numeNiciunul:'Нет имён для подтверждения.', tb_alegeJucator:'Выберите игрока из реестра', tb_leaga:'Связать', tb_jucatorNou:'Новый игрок', tb_numePrenume:'Укажите фамилию и имя нового игрока.', tb_confirmNou:(n)=>`Создать нового игрока «${n}»? Личную карточку (IDNP, документ и т. д.) заполните позже в его профиле.`, tb_legate:(n)=>`Связанные имена (${n}) — проверить или изменить`, tb_inTabel:'В таблице', tb_inRegistru:'В реестре', tb_st_auto:'автоматически', tb_st_confirmat:'подтверждено', tb_st_nou:'создан новый', tb_schimba:'Изменить', tb_eroare:'Синхронизация с таблицей не удалась:', tb_raport:'Синхронизация с таблицей', tb_raportSimulare:'Проверка — ничего не изменено', tb_simulareNota:'Это только проверка: показано, что изменилось бы. Ничего не сохранено.', tb_noi:'новых матчей', tb_actualizate:'обновлённых матчей', tb_loturiSchimbate:'заполненных составов', tb_r_nume_noi:'Новые имена для подтверждения', tb_r_conflicte:'Изменено вручную (сохранено)', tb_r_blocate:'В заблокированных неделях (без изменений)', tb_r_loturi_in_asteptare:'Составы, ожидающие подтверждения имён', tb_r_schimbari:'Изменения', tb_r_echipe_necunoscute:'Неизвестные команды', tb_r_erori:'Ошибки', tb_aplicatia:'приложение', tb_tabelul:'таблица', tb_nou:'новый', tb_inchide:'Закрыть', tb_ultimaTabel:'Последняя синхронизация с Google-таблицей:', tb_azi:'сегодня', tb_syncCuTabelul:'Синхронизировать с таблицей', tb_syncScurt:'Синхронизировать', tb_syncTitlu:'Сейчас взять матчи, составы и рейтинги из Google-таблицы', tb_tSincronizat:'Синхронизировано:', tb_tLaZi:'Всё совпадает с таблицей.', tb_tLoturi:(n)=>`составов: ${n}`, tb_tMeciuri:(n)=>`обновлено матчей: ${n}`, tb_tNume:(n)=>`имён для подтверждения: ${n} (Настройки)`, tb_tConflicte:(n)=>`ручных изменений сохранено: ${n}`, tb_tRaport:'Отчёт', tb_numeDeConfirmat:'имён для подтверждения', tb_badgeTabel:'Таблица', tb_dinTabelTitlu:'Результат и состав из Google-таблицы', tb_badgeManual:'изменён вручную', tb_manualTitlu:'Этот матч изменён вручную после синхронизации; таблица и сайт его больше не перезаписывают.', tb_preia:'Взять из таблицы', tb_confirmPreia:'Отменить ручные изменения этого матча и снова взять счёт и составы из таблицы?', iv2_title:'Создайте учётную запись', iv2_nume:'Отображаемое имя', iv2_numePh:'напр. Иван Попеску', iv2_passPh:'минимум 8 символов', iv2_pass2:'Повторите пароль', iv2_btn:'Создать учётную запись', iv2_checking:'Проверка ссылки…', iv2_role:(rol,exp)=>`Доступ: ${rol} · ссылка действует до ${exp}`, iv2_errInvalid:'Ссылка недействительна. Попросите администратора прислать новую.', iv2_errUsed:'Эта ссылка уже использована. Каждая ссылка создаёт только одну учётную запись.', iv2_errExpired:'Срок действия ссылки истёк. Попросите администратора прислать новую.', iv2_errCancelled:'Ссылка отменена администратором.', iv2_errEmailExists:'Учётная запись с этой почтой уже существует. Войдите с ней или используйте другую почту.', iv2_errEmail:'Введите корректный адрес эл. почты.', iv2_errPassword:'Пароль должен содержать не менее 8 символов.', iv2_errName:'Введите имя (не менее 2 символов).', iv2_errMismatch:'Пароли не совпадают.', iv2_errServer:'Ошибка сервера. Попробуйте ещё раз через несколько минут.', iv2_creating:'Создание учётной записи…', iv2_done:'Учётная запись создана. Вход в реестр…', iv2_doneLogin:'Учётная запись создана. Войдите, используя выбранные почту и пароль.', st_inv_title:'Ссылки для регистрации', st_inv_sub:'Создайте одноразовую ссылку и отправьте её человеку: он вводит имя, почту и пароль и получает учётную запись с выбранной ролью. Ссылка работает один раз и истекает через выбранный срок.', st_inv_rol:'Роль', st_inv_rolAsistent:'Ассистент (видит реестр, заполняет составы)', st_inv_rolAdmin:'Администратор (полный доступ)', st_inv_rolAsistentScurt:'Ассистент', st_inv_rolAdminScurt:'Администратор', st_inv_limba:'Язык страницы', st_inv_zile:'Действует', st_inv_btn:'Создать ссылку', st_inv_copy:'Копировать', st_inv_copied:'Скопировано ✓', st_inv_once:'Скопируйте ссылку сейчас: из соображений безопасности после ухода со страницы её нельзя будет показать снова. Если потеряете — отмените её и создайте новую.', st_inv_thCreat:'Создана', st_inv_thExpira:'Истекает', st_inv_thCont:'Созданная учётная запись', st_inv_activa:'активна', st_inv_folosita:'использована', st_inv_expirata:'истекла', st_inv_anulata:'отменена', st_inv_anuleaza:'Отменить', st_inv_none:'Ссылок пока нет.', st_inv_confirmAdmin:'Ссылка создаст учётную запись АДМИНИСТРАТОРА с полным доступом (выплаты, настройки, исправления). Продолжить?', st_inv_confirmAnulare:'Отменить эту ссылку? Ею больше нельзя будет воспользоваться.',
  au_emailPh:'name@example.com', au_passPh:'••••••••',
  au_modeAdmin:'Администратор', au_modeLocatie:'Локация', au_pin:'PIN-код', au_pinPh:'••••••',
  au_pinNeed:'Введите PIN-код.', au_pinWrong:'Неверный PIN-код.',
  au_pinRateLimited:'Слишком много неверных попыток. Повторите через 15 минут.',
  au_pinNotTrusted:'Этот компьютер не авторизован для учётной записи локации.',
  au_pinNotTrustedHint:'Сообщите этот код администратору, чтобы авторизовать этот компьютер:',
  au_pinServerError:'Ошибка соединения. Попробуйте снова.',

  st_trustedIps:'Доверенные локации', st_trustedIpsSub:'Только компьютеры с этими IP-адресами могут использовать учётную запись локации.',
  st_ipAddr:'IP-адрес', st_ipAddrPh:'напр. 84.20.13.5', st_ipEticheta:'Метка (необязательно)', st_ipEtichetaPh:'напр. Компьютер на ресепшене',
  st_ipAdauga:'+ Добавить', st_ipNone:'Пока нет авторизованных адресов.', st_ipAdaugat:'добавлен',
  st_pinLocatie:'PIN учётной записи локации', st_pinLocatieSub:'Код, который менеджеры используют для входа в общую учётную запись локации.',
  st_pinNou:'Новый PIN', st_pinSchimba:'Изменить PIN', st_pinSchimbat:'PIN изменён.',
  st_pinTooShort:'PIN должен содержать не менее 4 символов.',

  nav_dashboard:'Панель управления', nav_participanti:'Участники', nav_intarzieri:'Опоздания',
  nav_vestimentatie:'Форма', nav_serviciu:'Смены администраторов', nav_spalatorie:'Прачечная',
  nav_hostel:'Хостел', nav_lenjerie:'Постельное бельё', nav_medical:'Медицина', nav_daune:'Ущерб и возмещение', nav_fairplay:'Фэйр-плей',
  nav_arbitraj:'Судейство', nav_antrenamente:'Тренировки', nav_inventar:'Инвентарь', nav_sarcini:'Задачи', nav_observatii:'Замечания',
  nav_pauzatehnica:'Технический перерыв',
  nav_rapoarte:'Отчёты', nav_setari:'Настройки',
  sb_sub:'Журнал · BSKT Cup', sb_shift:'Текущая смена', hdr_logout:'Выход',

  th_cont:'Аккаунт', th_data:'Дата', th_actiune:'Действие', th_participant:'Участник', th_stare:'Состояние',
  ac_participantPh:'Поиск по имени...', ac_noResults:'Нет результатов',
  th_administrator:'Администратор', th_categorie:'Категория', th_descriere:'Описание', th_statut:'Статус',
  btn_add:'+ Добавить', btn_delete:'Удалить', btn_cancel:'Отмена', btn_save:'Сохранить изменения',
  btn_saving:'Сохранение…', empty_dash:'—',

  da_title:'Панель управления', da_stat_activi:'Активные участники', da_stat_medical:'Медицинские справки',
  da_stat_stoc:'Товары ниже минимума', da_stat_sarcini:'Нерешённые задачи >48ч',
  da_stat_hostel:'Заселены в хостел (сегодня)', da_alerts_title:'Автоматические уведомления',
  da_alerts_empty:'Активных уведомлений нет.', da_jurnal_title:'Журнал активности — последние действия',
  da_total_inreg:'всего зарегистрировано', da_expira30:'истекают', da_din:'из', da_categorii:'категорий',
  da_total_lucru:'всего в работе', da_total_inregistrari:'всего записей',
  sh_startTitle:'Начать смену на локации', sh_startSub:'Начните смену, чтобы разблокировать журнал и увидеть понятный список дел на сегодня.',
  sh_startBtn:'Начать смену', sh_chooseName:'Кто сегодня на смене?', sh_confirmStart:'Подтвердить и начать',
  sh_active:'Смена активна', sh_demo:'Демонстрационный режим администратора', sh_stop:'Завершить смену',
  sh_refTitle:'Судьи на сегодня', sh_refHelp:'Сохраните имя и зал сейчас. Количество мячей можно заполнить здесь позже.',
  sh_referee:'Судья', sh_venue:'Зал', sh_saveRef:'Сохранить', sh_saved:'сохранено', sh_balls:'Мячи',
  sh_updateBalls_old:'Обновить', sh_correctRef:'Исправить', sh_saveCorrection:'Сохранить исправление', sh_cancelCorrection:'Отмена', sh_correcting:'исправляется',
  sh_correctionError:'Не удалось сохранить исправление.', sh_inventoryTitle:'Поступление инвентаря', sh_inventoryHelp:'Сразу зарегистрируйте полученный сегодня товар или оборудование.',
  sh_item:'Позиция', sh_quantity:'Количество', sh_addStock:'Добавить на склад',
  sh_trainingTitle:'Тренировки на сегодня', sh_trainingHelp:'Добавьте тренера, спортсмена и время; запись сразу появится в разделе тренировок.',
  sh_trainer:'Тренер', sh_trainee:'Спортсмен', sh_time:'Время', sh_addTraining:'Сохранить тренировку',
  sh_addRow:'+ Ещё тренировка', sh_noEligible:'Нет спортсменов, допущенных к тренировкам.',
  sh_startError:'Не удалось начать смену.', sh_stopError:'Не удалось завершить смену.',
  sh_stopAlreadyEnded:'Эта смена уже была завершена (вероятно, с другой вкладки или устройства). Страница обновлена.',
  sh_reportRequired:'Смену нельзя завершить до создания отчёта смены. Создайте и сохраните отчёт, затем повторите попытку.',
  sh_reportCheckError:'Не удалось проверить отчёт смены. Смена останется открытой. Повторите попытку.',
  sh_reportFinalizeError:'Не удалось обновить итоговый отчёт. Смена останется открытой, данные не потеряны.',
  app_updateRequired:'Опубликована новая версия журнала. Страница сейчас перезагрузится; затем повторите действие.',
  refresh_reminderTitle:'Поддерживайте журнал в актуальном состоянии',
  refresh_reminderText:'Периодически обновляйте страницу, чтобы журнал работал корректно и показывал свежие данные.',
  refresh_updateTitle:'Доступно обновление',
  refresh_updateText:'Доступна новая версия. Обновите страницу перед созданием отчёта или завершением смены.',
  refresh_verifyTitle:'Не удалось проверить версию',
  refresh_verifyText:'Смена останется открытой, данные в безопасности. Проверьте соединение и повторите попытку.',
  refresh_now:'Обновить', refresh_close:'Закрыть',
  sh_stopConfirm:'Вы уверены, что хотите завершить смену? После подтверждения журнал будет заблокирован, и для дальнейшего редактирования потребуется начать новую смену.',
  sh_locked:'Журнал заблокирован. Начните смену на панели управления.',

  pa_title:'Участники', pa_sub:'Основные данные спортсменов, зарегистрированных на локации.',
  pa_addTitle:'Добавление нового участника', pa_dulap:'№ шкафчика', pa_dulapPh:'напр. 118', pa_nume:'Фамилия', pa_prenume:'Имя',
  pa_nastere:'Дата рождения', pa_telefon:'Телефон', pa_telefonPh:'+373 6XXXXXXX', pa_email:'Эл. почта', pa_emailPh:'name@mail.md',
  pa_adresa:'Адрес проживания', pa_adresaPh:'г. Кишинёв, ул. ...', pa_aviz:'Дата медицинской справки',
  pa_marime:'Размер формы', pa_btnAdd:'+ Добавить участника', pa_searchPh:'Поиск по имени, телефону или № шкафчика...',
  pa_th_dulap:'Шкафчик', pa_th_naștere:'Рождение', pa_th_avizMed:'Мед. справка', pa_th_marime:'Размер',
  pa_categorieSp:'Спортивная категория', pa_th_categorieSp:'Категория',
  pa_sortare:'Сортировка', pa_sortNume:'Имя (A-Z)', pa_sortStatut:'Статус (активен/неактивен)', pa_sortCategorie:'Фильтр по категории',
  pa_inactivPrimii:'Неактивные сначала', pa_inactivUltimii:'Неактивные в конце',
  pa_toateCategoriile:'Все категории', pa_faraCategorie:'Без категории',
  pa_none:'Участник не найден.', pa_countSuffix:'участников',
  pa_needNumePrenume:'Заполните хотя бы фамилию и имя.',
  pa_editTitle:'Изменить данные участника', pa_editBtn:'Редактировать данные', pa_nespecificata:'Не указан',
  pa_deleteBtn:'Удалить участника', pa_deleteTitle:'Удалить участника из реестра',
  pa_deleteConfirm:(nume)=>`Окончательно удалить участника ${nume}? Будут удалены и все связанные записи (опоздания, форма, прачечная, бельё, хостел, ущерб, замечания). Это действие необратимо.`,
  pa_needNumePrenume2:'Фамилия и имя обязательны.',
  pa_fisa:'Карточка участника', pa_statut:'Статус', pa_faraAviz:'справка не зарегистрирована',
  pa_expiraLa:'дней', pa_k_intarzieri:'Опоздания', pa_k_vestimentatie:'Полученная форма', pa_k_cazari:'Проживание в хостеле',
  pa_k_lenjerie:'Бельё', pa_k_daune:'Причинённый ущерб', pa_k_observatii:'Замечания', pa_fara_inreg:'Нет записей.',
  pa_k_antrenamente:'Тренировки',
  pa_intarziere_word:'Опоздание', pa_cazare_word:'Заселение', pa_eliberat_returnat:'Выдано → возвращено',
  pa_nereturnat:'не возвращено',

  it_title:'Опоздания', it_sub:'Учёт опозданий спортсменов на локацию, с автоматической статистикой.',
  it_totalInreg:'Всего записано', it_lunaCurenta:'Текущий месяц', it_frecventi:'Частые опоздания (≥3/30 дней)',
  it_addTitle:'Регистрация опоздания', it_topTitle:'Участники с наибольшим числом опозданий (30 дней)',
  it_nrIntarzieri:'Кол-во опозданий', it_allTitle:'Все опоздания', it_none:'Опозданий не зарегистрировано.',
  it_minute:'Минуты', it_motiv:'Причина',

  ve_title:'Форма', ve_sub:'Выдача формы спортсменам — автоматически списывается со склада.',
  ve_addTitle:'Выдача формы', ve_tip:'Тип изделия', ve_marime:'Размер', ve_cantitate:'Количество',
  ve_data:'Дата', ve_btnAdd:'+ Выдать', ve_th_tip:'Тип', ve_th_cantitate:'Количество', ve_th_returnare:'Возврат',
  ve_countSuffix:'выдач', ve_none:'Выдач не зарегистрировано.',
  ve_hint:'Нажмите на статус, чтобы отметить возврат',
  ve_confirmReturn:'Подтвердить, что форма возвращена? После подтверждения отменить это смогут только администраторы.',
  ve_lockedHint:'Возврат подтверждён — отменить может только администратор.',

  se_title:'Смены администраторов', se_sub:'График смен администраторов на локации.',
  se_overlap:'Обнаружено пересечение смен на:', se_addTitle:'Добавление смены',
  se_raportTitle:'Отчёт по отработанным сменам', se_nrSchimburi:'Кол-во смен', se_calendarTitle:'Календарь смен',
  se_startTime:'Начало', se_endTime:'Окончание',
  se_filterMonth:'Сменить месяц', se_month:'Месяц', se_allMonths:'Все месяцы',
  se_none:'Смены не зарегистрированы.',

  sp_title:'Прачечная', sp_sub:'Учёт химчистки и сумм к оплате.',
  sp_totalChelt:'Общие расходы на прачечную', sp_operatiuni:'операций', sp_addTitle:'Сдача в прачечную',
  sp_tipArt:'Тип изделий', sp_tipArtPh:'напр. майка, шорты', sp_dataPredarii:'Дата сдачи', sp_suma:'Сумма (MDL)',
  sp_th_articole:'Изделия', sp_th_suma:'Сумма', sp_countSuffix:'записей', sp_none:'Записей нет.',
  sp_cantitate:'Количество', sp_th_cantitate:'Кол-во', sp_locatia:'Локация (без участника)',
  sp_th_returnare:'Дата возврата', sp_hint:'Нажмите на статус, чтобы отметить возврат',
  sp_confirmReturn:'Подтвердить возврат изделий из прачечной? После подтверждения отменить это смогут только администраторы.',
  sp_lockedHint:'Возврат подтверждён — отменить может только администратор.',
  sp_filtruTitle:'Сменить месяц', sp_luna:'Месяц', sp_toatePerioadele:'Все месяцы',
  sp_btnRaport:'⇩ Месячный отчёт (PDF)', sp_raportTitlu:'Отчёт по прачечной',
  sp_raportPerioada:'Период', sp_raportToate:'Все месяцы', sp_raportNimic:'За выбранный период нет записей по прачечной.',
  sp_raportTh_nr:'№', sp_raportTh_beneficiar:'Участник / локация', sp_raportTh_operatiuni:'Операций',
  sp_raportTh_articole:'Изделий', sp_raportTh_total:'Всего',
  sp_raportTotalGeneral:'ОБЩИЙ ИТОГ', sp_raportBeneficiari:'Получателей', sp_raportGenerat:'Сформировано',

  ho_title:'Хостел', ho_sub:'Ночные заселения спортсменов на локации.', ho_cazatiAzi:'Заселены сегодня',
  ho_totalNopti:'Всего ночей зарегистрировано', ho_addTitle:'Регистрация заселения', ho_dataCazarii:'Дата заселения',
  ho_observatii:'Замечания', ho_observatiiPh:'напр. Комната 2', ho_noptiTitle:'Ночей на участника',
  ho_nrNopti:'Кол-во ночей', ho_faraDate:'Нет данных.', ho_toateCazarile:'Все заселения', ho_th_observatii:'Замечания',
  ho_none:'Заселений нет.',
  ho_cazatiActivAcum:'Активно проживают сейчас', ho_th_statut:'Статус', ho_statutHint:'Нажмите на статус, чтобы закрыть проживание',

  le_title:'Постельное бельё', le_sub:'Учёт постельного белья, выданного спортсменам в хостеле.', le_addTitle:'Выдача белья',
  le_dataElib:'Дата выдачи', le_countSuffix:'записей', le_hint:'Нажмите на статус, чтобы отметить возврат',
  le_stockSource:'Источник запаса', le_stockNew:'Новое', le_stockUsed:'Б/у', le_available:'доступно',
  le_th_source:'Источник', le_th_eliberare:'Выдача', le_th_returnare:'Возврат', le_none:'Записей нет.',
  le_noStockNew:'Новое бельё закончилось. Выберите «Б/у» вручную, если хотите выдать бельё из использованного запаса.',
  le_noStockUsed:'Использованное бельё закончилось. Выберите «Новое» вручную, если хотите выдать бельё из нового запаса.',
  le_confirmReturn:'Подтвердить, что бельё возвращено? После подтверждения отменить это смогут только администраторы.',
  le_lockedHint:'Возврат подтверждён — отменить может только администратор.',

  me_title:'Медицина', me_sub:'Медицинские справки, по возрастанию оставшихся дней. Срок действия: 6 месяцев.',
  me_expirate:'Истекли', me_expira30:'Истекают < 30 дней', me_valabile:'Действительны', me_faraAviz:'Активные без мед. справки',
  me_tableTitle:'Медицинские справки — все активные участники', me_th_dataAvizului:'Дата справки',
  me_th_dataExpirarii:'Дата истечения', me_th_zileRamase:'Осталось дней', me_none:'Нет активных участников.',

  da2_title:'Ущерб и возмещение', da2_sub:'Учёт ущерба, нанесённого локации (повреждённый/уничтоженный инвентарь).',
  da2_addTitle:'Регистрация ущерба', da2_inventarAfectat:'Затронутый инвентарь', da2_inventarAfectatPh:'напр. Стол №1',
  da2_natura:'Характер повреждения', da2_naturaPh:'напр. Трещина столешницы', da2_stareBun:'Состояние',
  da2_teren:'Корт', da2_th_teren:'Корт',
  da2_th_inventarAfectat:'Затронутый инвентарь', da2_th_natura:'Характер', da2_countSuffix:'случаев ущерба',
  da2_none:'Случаев ущерба не зарегистрировано.', da2_valoare:'Оценочный ущерб (MDL)', da2_avertizor:'Кто сообщил',
  da2_observatii:'Примечания', da2_afectat:'затронуто', da2_deteriorat:'повреждено',
  da2_totalValoare:'Общий оценочный ущерб', da2_totalAfectate:'Затронутые предметы', da2_totalDeteriorate:'Повреждённые предметы',
  da2_filterMonth:'Период отчёта', da2_month:'Месяц', da2_sixMonths:'6 месяцев', da2_year:'Год',
  da2_endMonth:'Конечный месяц', da2_reportTitle:'Отчёт по причинённому ущербу — по количеству',
  da2_reportSub:'Рейтинг по количеству случаев ущерба независимо от их стоимости.',
  da2_reportCount:'Кол-во случаев', da2_reportNone:'За выбранный период ущерб не зарегистрирован.',

  fp_title:'Фэйр-плей', fp_sub:'Учёт жёлтых и красных карточек, выданных спортсменам.',
  fp_addTitle:'Регистрация санкции', fp_numeSportiv:'Имя спортсмена', fp_platou:'Игровая площадка',
  fp_descriere:'Описание нарушения', fp_descrierePh:'напр. Неспортивное поведение по отношению к судье',
  fp_cartonas:'Карточка', fp_galben:'жёлтая', fp_rosu:'красная', fp_ora:'Время (необязательно)',
  fp_th_ora:'Время', fp_th_platou:'Площадка', fp_th_descriere:'Описание', fp_th_cartonas:'Карточка',
  fp_countSuffix:'зарегистрированных санкций', fp_none:'Санкции не зарегистрированы.',
  fp_totalSanctiuni:'Всего санкций', fp_totalGalbene:'Жёлтые карточки', fp_totalRosii:'Красные карточки',
  fp_filterMonth:'Период отчёта', fp_month:'Месяц', fp_sixMonths:'6 месяцев', fp_year:'Год',
  fp_endMonth:'Конечный месяц', fp_reportTitle:'Рейтинг карточек — по количеству',
  fp_reportSub:'Рейтинг спортсменов по количеству полученных карточек.',
  fp_reportGalbene:'Жёлтые', fp_reportRosii:'Красные', fp_reportTotal:'Всего',
  fp_reportNone:'За выбранный период санкций не зарегистрировано.', fp_needSportiv:'Выберите спортсмена.',

  ar_title:'Судейство', ar_sub:'Судьи турниров и количество выданных новых мячей — автоматически списывается со склада.',
  ar_addTitle:'Выдача мячей судье', ar_numeArbitru:'Имя судьи', ar_numeArbitruPh:'Имя судьи',
  ar_turneu:'Турнир', ar_mingiNoi:'Новые мячи', ar_th_arbitru:'Судья', ar_th_turneu:'Турнир', ar_th_mingiNoi:'Новые мячи',
  ar_marcaMingi:'Марка', ar_th_marcaMingi:'Марка',
  ar_countSuffix:'выдач', ar_none:'Выдач нет.', ar_needNume:'Введите имя судьи.',
  arb_title:'Реестр судей', arb_sub:'Судьи, доступные для турниров — управляйте списком здесь.',
  arb_addTitle:'Добавление нового судьи', arb_btnAdd:'+ Добавить судью', arb_countSuffix:'судей', arb_none:'Судьи не зарегистрированы.',
  arb_fisa:'Карточка судьи', arb_editTitle:'Изменить данные судьи', arb_editBtn:'Редактировать данные',
  arb_deleteBtn:'Удалить судью', arb_deleteTitle:'Удалить судью из реестра',
  arb_deleteConfirm:(nume)=>`Окончательно удалить судью ${nume}? Это действие необратимо.`,

  an_title:'Тренировки', an_sub:'Индивидуальные тренировки — 100 MDL/сессию от игрока, 200 MDL/сессию тренеру.',
  an_totalSesiuni:'Всего сессий', an_totalIncasat:'Получено от игроков', an_sumarAntrenori:'Сводка по тренерам',
  an_addTitle:'Регистрация тренировки', an_jucator:'Игрок', an_antrenor:'Тренер', an_ora:'Время (необязательно)',
  an_btnAdd:'+ Зарегистрировать', an_th_jucator:'Игрок', an_th_antrenor:'Тренер', an_th_ora:'Время',
  an_th_sumaJucator:'Сумма игрока', an_th_sumaAntrenor:'Сумма тренера', an_countSuffix:'сессий', an_none:'Сессий нет.',
  an_eligibiliTitle:'Игроки, допущенные к тренировкам', an_eligibiliSub:'Только эти игроки появляются в форме выше. Выберите из всех участников.',
  an_adaugaEligibil:'Добавить допущенного игрока', an_eligibilAdaugat:'+ Добавить', an_eligibilNone:'Пока нет допущенных игроков.',
  an_needJucator:'Выберите допущенного игрока.', an_neeligibil:'Этот игрок не отмечен как допущенный к тренировкам.',
  an_perioada:'Фильтр по месяцу', an_luna:'Месяц', an_toateLunile:'Все месяцы',
  an_btnRaportJucatori:'⇩ Отчёт по игрокам (PDF)', an_raportTitlu:'Отчёт по тренировкам по игрокам',
  an_raportPerioada:'Период', an_raportToate:'Все месяцы', an_raportNimic:'За выбранный период нет тренировок.',
  an_raportTh_nr:'№', an_raportTh_jucator:'Игрок', an_raportTh_sesiuni:'Сессии', an_raportTh_total:'Всего оплачено',
  an_raportTotalGeneral:'ОБЩИЙ ИТОГ', an_raportJucatoriDistincti:'Игроков', an_raportGenerat:'Сформировано',

  iv_title:'Инвентарь', iv_sub:'Запас товаров на локации. Текущее количество автоматически снижается при выдаче.',
  iv_lowStock:'товаров ниже допустимого минимума.', iv_addTitle:'Приход / корректировка склада', iv_articol:'Товар',
  iv_tipMiscare:'Тип операции', iv_intrare:'приход', iv_iesire:'расход', iv_corectare:'корректировка', iv_coloana:'Исправляемая колонка', iv_btnAdd:'+ Зарегистрировать',
  iv_structTitle:'Структура склада', iv_th_articol:'Товар', iv_th_culoare:'Цвет', iv_th_marime:'Размер',
  iv_uzateTitle:'Б/у', iv_uzateSub:'Товары, выведенные из нового запаса и используемые как бывшие в употреблении (майки, шорты, бельё).',
  iv_th_um:'Ед.изм.', iv_th_initial:'Начальный', iv_th_intrari:'Приход', iv_th_iesiri:'Расход', iv_th_curent:'Текущий',
  iv_th_minim:'Минимум', iv_th_stare:'Состояние',

  ta_title:'Задачи', ta_sub:'Задачи и нерешённые проблемы. Система отмечает просроченные более 48 часов.',
  ta_total:'Всего задач', ta_nesolutionate:'Нерешённые', ta_restante:'Просрочено >48ч',
  ta_addTitle:'Регистрация задачи', ta_descriere:'Описание проблемы', ta_descrierePh:'напр. Перегорела лампа в раздевалке',
  ta_th_inregDe:'Зарегистрировал', ta_th_status:'Статус', ta_th_solDe:'Решил', ta_countSuffix:'задач',
  ta_filterAll:'Все', ta_filterOpen:'Нерешённые', ta_filterSolved:'Решённые',
  ta_none:'Задач не зарегистрировано.', ta_needDesc:'Опишите задачу.',
  ta_st_nesolutionat:'не решено', ta_st_inLucru:'в работе', ta_st_solutionat:'решено',

  ob_title:'Замечания', ob_sub:'Краткие ситуации об участниках, объекте или ежедневной работе.',
  ob_addTitle:'Регистрация замечания', ob_targetType:'Замечание относится к', ob_targetParticipant:'Участник', ob_targetGeneral:'Общая ситуация',
  ob_target:'Участник / Тема', ob_subject:'Тема', ob_subjectPh:'напр. объект, уборка, раздевалка...', ob_categorie:'Категория', ob_descScurta:'Краткое описание',
  ob_descScurtaPh:'детали...', ob_countSuffix:'замечаний', ob_none:'Замечаний нет.', ob_needParticipant:'Выберите участника.', ob_needSubject:'Введите тему ситуации.',

  pt_title:'Технический перерыв', pt_sub:'Учёт задержек начала матчей — интервал перерыва, корт и причина.',
  pt_addTitle:'Регистрация технического перерыва', pt_oraStart:'С', pt_oraStop:'По', pt_teren:'Корт',
  pt_descriere:'Что произошло', pt_descrierePh:'напр. Порвана сетка, заменена за 15 мин.',
  pt_th_interval:'Интервал', pt_th_durata:'Длительность', pt_th_teren:'Корт', pt_th_descriere:'Описание',
  pt_countSuffix:'перерывов зарегистрировано', pt_none:'Технических перерывов нет.',
  pt_needOre:'Укажите время начала и окончания.', pt_needDescriere:'Опишите причину технического перерыва.',
  pt_totalPauze:'Перерывы (30 дней)', pt_totalMinute:'Потеряно минут (30 дней)', pt_medie:'Средняя длительность',
  pt_minSuffix:'мин', pt_showing:(n,total)=>`Последние ${n} из ${total}`,

  re_title:'Отчёты и статистика', re_sub:'Формирование отчётов за любой период. Экспорт: Excel, PDF, печать.',
  re_perioada:'Период отчёта', re_de_la:'С', re_pana_la:'По', re_excel:'Excel', re_pdf:'PDF',
  act_sectionTitle:'Отчёты смены', act_sectionSub:'Отчёты, сформированные при закрытии каждой смены.',
  act_pastTitle:'Сформировать отчёт для прошедшей смены', act_pastLoad:'Загрузить смены', act_pastPick:'Смена',
  act_pastNone:'Завершённых смен не найдено.', act_pastAlready:'(отчёт уже создан)',
  act_none:'Отчёты смены ещё не созданы.', act_btnGenerate:'Сформировать отчёт', act_generating:'Формируется…',
  act_docTitle:'Отчёт смены', act_perioada:'Период',
  act_s_admin:'Админ', act_s_intarzieri:'Опоздания', act_s_arbitraj:'Арбитраж', act_s_fairplay:'Фэйр-плей',
  act_s_daune:'Ущерб', act_s_inventar:'Инвентарь', act_s_hostel:'Хостел', act_s_treninguri:'Тренировки', act_s_sarcini:'Задачи', act_s_observatii:'Замечания',
  act_s_pauzatehnica:'Технический перерыв', act_teren:'Корт', act_interval:'Интервал', act_durata:'Длительность',
  act_conditie:'Состояние',
  act_dataSchimb:'Дата смены', act_numeAdmin:'Имя администратора',
  act_numeSportiv:'Имя спортсмена', act_min:'Мин', act_motiv:'Причина',
  act_numeArbitru:'Имя судьи', act_cartonas:'Карточка', act_descriere:'Описание', act_platou:'Площадка',
  act_tipMiscare:'Приход/расход', act_articol:'Наименование', act_cantitate:'Кол-во', act_sursa:'Имя участника/поставщика',
  act_camera:'Комната', act_oraCazarii:'Заселение', act_statut:'Статус',
  act_antrenor:'Тренер', act_data:'Дата', act_ora:'Время', act_programat:'Запланировано', act_desfasurat:'Проведено', act_da:'ДА', act_nu:'НЕТ',
  act_goale:'—', act_noEntries:'нет записей', act_generat:'Отчёт смены сформирован и сохранён в Отчётах.', act_needShift:'Нет активной смены.',
  re_print:'Печать', re_sect_participanti:'Отчёты об участниках', re_sect_admin:'Административные отчёты',
  re_sect_fin:'Финансовые отчёты', re_sect_inv:'Отчёты по складу',
  re_r_intarzieri:'Зарегистрированные опоздания', re_r_obsAbs:'Замечания / отсутствия', re_r_cazariHostel:'Заселения в хостел',
  re_r_vestElib:'Выданная форма', re_r_avizeExp:'Истёкшие мед. справки', re_r_dauneProv:'Причинённый ущерб',
  re_r_schimburi:'Запланированные смены', re_r_sarciniInreg:'Зарегистрированные задачи', re_r_sarciniSol:'Решённые задачи',
  re_r_cheltSpal:'Расходы на прачечную', re_noExcel:'Модуль Excel не загрузился. Проверьте интернет-соединение и обновите страницу.',
  re_noPdf:'Модуль PDF не загрузился. Проверьте интернет-соединение и обновите страницу.',
  re_popupBlocked:'Браузер заблокировал окно печати. Разрешите всплывающие окна для этого сайта.',
  re_tipRaport:'Тип отчёта', re_type_total:'Полный отчёт', re_type_intarzieri:'Опоздания',
  re_type_spalatorie:'Прачечная', re_type_medical:'Медицина', re_type_daune:'Ущерб и восстановление',
  re_type_arbitraj:'Арбитраж', re_type_antrenamente:'Тренировки', re_type_inventar:'Склад',
  re_sect_intarzieri:'Отчёт по опозданиям', re_sect_spalatorie:'Отчёт по прачечной', re_sect_medical:'Медицинский отчёт',
  re_sect_daune:'Отчёт по ущербу и восстановлению', re_sect_arbitraj:'Отчёт по арбитражу', re_sect_antrenamente:'Отчёт по тренировкам',
  re_m_totalSesiuniAntrenament:'Всего тренировок', re_m_incasatAntrenament:'Получено от игроков',
  re_m_totalIntarzieri:'Всего опозданий', re_m_totalMinute:'Всего минут опоздания', re_m_frecventi:'Частые опоздания (≥3/30 дней)',
  re_m_operatiuniSpal:'Операций прачечной', re_m_cantitateArt:'Количество изделий', re_m_cheltuieliTotale:'Общие расходы',
  re_m_spalReturnate:'Возвращено из прачечной', re_m_spalNereturnate:'Не возвращено из прачечной',
  re_m_aviziPerioada:'Справок за период', re_m_valabile:'Действительны', re_m_expiraCurand:'Скоро истекают', re_m_expirate:'Истекли',
  re_m_totalDaune:'Всего зарегистрировано ущерба', re_m_eliberariArb:'Зарегистрированных выдач',
  re_m_mingiDhs:'Выдано мячей DHS', re_m_mingiJoola:'Выдано мячей JOOLA',

  st_title:'Настройки', st_sub:'Администраторы, пороги уведомлений и полный журнал активности.',
  st_admins:'Администраторы', st_rol:'Роль', st_rolValue:'Администратор локации', st_activAcum:'сейчас в сети',
  st_rolLocatieCont:'Общая учётная запись локации',
  as_cDeRezolvat:'Требует внимания', as_urgente:'срочных', as_nimicUrgent:'ничего срочного', as_cFaraLot:'Матчи без состава', as_cFaraLotSub:'последние 60 дней · игрокам не начислено', as_cBrutSapt:'Брутто на этой неделе', as_dinLuni:'с понедельника', as_faraLotScurt:'без состава',
  as_deRezolvatTitlu:'Требует внимания', as_seIncarca:'загрузка…', as_totInRegula:'Всё в порядке — ничего не требует внимания.',
  as_t_lineup:'Состав', as_t_match:'Матч', as_t_sync:'Результаты', as_t_referee:'Арбитраж', as_t_medical:'Медицина', as_t_team:'Команда', as_t_fairplay:'Фэйр-плей', as_t_late:'Опоздания', as_t_kit:'Возврат', as_t_inventory:'Инвентарь', as_t_task:'Задача',
  as_pLot:(d,n)=>`${d}: ${n} ${plural(n,'mt_meciuriSuffix','ru')} сыграно без состава — игрокам не начислено, пока состав не заполнен.`,
  as_pFaraScor:(n,d)=>`${n} ${plural(n,'mt_meciuriSuffix','ru')} прошлых дней без счёта (последний: ${d}).`,
  as_pSyncEroare:(w,e)=>`Последняя синхронизация результатов (${w}) завершилась ошибкой${e?': '+e:''}.`,
  as_pSyncVechi:(w)=>`Результаты не синхронизировались с ${w} — проверьте автоматическую синхронизацию.`,
  as_pSyncIgnorate:(n)=>`Последняя синхронизация пропустила ${n} ${plural(n,'mt_meciuriSuffix','ru')}: команды сайта не связаны с командами реестра.`,
  as_pSyncNiciodata:'Результаты ещё ни разу не синхронизировались.',
  as_pPeste2:(d,n)=>`${d}: больше двух арбитров (${n}).`,
  as_pOreLipsa:(d,n)=>`${d}: арбитраж без указанных часов (${n}) — оплата 0 до заполнения.`,
  as_pAvizExpirat:(n,l)=>`Просроченные медсправки (${n}): ${l}.`,
  as_pAvizCurand:(n,l)=>`Медсправки истекают в течение 30 дней (${n}): ${l}.`,
  as_pEchipaMica:(e,n)=>`${e}: в команде только ${n} ${plural(n,'pa_countSuffix','ru')} (на площадке нужно минимум 3).`,
  as_pFaraEchipa:(n,l)=>`Активные игроки без команды (${n}): ${l}.`,
  as_pFairPlay:(p,tip,d)=>`${p}: ${tip} (${d}).`,
  as_pIntarzieri:(p,n)=>`${p}: ${n} опозданий за последние 30 дней.`,
  as_pVestimentatie:(n,l)=>`Не возвращена экипировка (${n}): ${l}.`,
  as_pSpalatorie:(n)=>`Не возвращено из прачечной более 2 дней: ${n}.`,
  as_pLenjerie:(n)=>`Не возвращено бельё более 7 дней: ${n}.`,
  as_pSarciniDeschise:(n)=>`Открытых задач: ${n}.`,
  ar2_regula:(ora,pct,brut)=>`Каждый арбитр, один или в паре: ${ora} лей нетто за час судейства. Компания платит брутто ${money(brut)} лей/час (нетто ÷ (1 − ${pct}%)); арбитр платит удержание ${pct}% и получает ${ora} лей/час.`,
  ar2_net:(ora)=>`Нетто (${ora}/час)`, ar2_retinere:(pct)=>`Удержание ${pct}%`, ar2_tOra:'Лей нетто в час (каждому арбитру)',
  ar2_obsLipsa:(n)=>`${n} ${plural(n,'pa_expiraLa','ru')} без указанных часов`,
  ar2_avertOreLipsa:(n)=>`${n} ${plural(n,'pa_expiraLa','ru')} арбитража без времени начала/окончания — оплата 0 до заполнения (Арбитраж → Часы).`,
  ar2_hint:'Нажмите на арбитра, чтобы увидеть детали по дням. Часы заполняются в Арбитраже или на панели смены.',
  fl_label:'Фрилансер', fl_da:'Да', fl_nu:'Нет', fl_daLung:'Да — платим брутто (сам платит 15%)', fl_nuLung:'Нет — платим нетто',
  fl_nuCalc:'Не фрилансер: компания платит нетто (налог уплачивается иначе).', fl_schimba:'Изменить статус фрилансера',
  fl_reviewTitlu:'Проверьте статус фрилансера',
  fl_explDa:'Фрилансер: компания платит брутто (нетто ÷ 0,85); человек платит 15% и получает нетто.',
  fl_explNu:'Не фрилансер: компания платит только нетто; налог уплачивается иначе.',
  as_impactPlata:'Влияние на выплаты (сумма к выплате)',
  as_jucDatePersonale:'Личная карточка игрока (дата рождения, адрес, документ, IDNP, телефон, контакты и остальные личные данные) видна только администраторам.',
  as_arbInregistrat:'Внесён в реестр', as_arbDatePersonale:'Личные данные арбитра (дата рождения, адрес, документ, телефон, медсправка) видны только администраторам.',
  as_paSub:'Игроки BSKT Cup — команда, результаты и спортивная история.', as_paSearchPh:'Поиск по имени или команде…',
  as_rol:'Ассистент (только чтение)', as_cont:'Учётная запись ассистента', as_readOnly:'У учётной записи ассистента только право чтения — изменение не выполнено.',
  as_dashSub:'ассистент · только чтение', as_echipeActive:'активных команд', as_ultimaZi:'Последний игровой день',
  as_linkPlati:'Выплаты по игрокам, командам и арбитрам; экспорт Excel', as_linkStats:'Винрейт, +/−, капитаны, таблица команд', as_linkMeciuri:'Результаты и составы по дням', as_linkJucatori:'Спортивные профили и история',
  as_doarCitire:'Эта учётная запись просматривает и экспортирует данные. Может добавлять матчи и заполнять составы (с понедельника прошлой недели), менять составы команд, а также статус, медсправку и шкафчик игроков — каждое сохранение проверяется, записывается и может быть отменено администратором. Личная карточка недоступна.',
  as_fereastra:(a,b)=>`Ассистент может добавлять и изменять матчи с ${a} по ${b}.`, as_inafaraFerestrei:(a,b)=>`Дата вне разрешённого периода (${a} – ${b}).`,
  as_teamNota:'Ассистент может менять только состав команды (игроки, номер, капитан/игрок). Название, цвет и статус команды меняет администратор.',
  as_teamPlataNota:'Состав команды не меняет выплаты за уже сыгранные матчи; он служит предложением для составов следующих матчей.',
  as_profilNota:'Ассистент может менять статус, дату медсправки, номер шкафчика и статус фрилансера.', as_avizInvalid:'Дата медсправки должна быть за последний год и не в будущем.',
  as_reviewMeciNou:'Проверьте новый матч', as_reviewMeci:'Проверьте изменения матча', as_reviewEchipa:'Проверьте изменения состава', as_reviewJucator:'Проверьте изменения игрока',
  as_reviewNota:'Изменение сохраняется сразу, записывается и может быть отменено администратором.', as_inapoi:'Назад к редактированию', as_confirma:'Подтвердить и сохранить',
  as_chData:'Дата', as_chEchipe:'Команды', as_chDetalii:'Детали (№, площадка, арбитр, примечания или OT)', as_nou:'новый', as_faraSchimbari:'Состав не изменён.',
  as_faraScorPlata:'У матча ещё нет счёта — выплата посчитается автоматически, когда появится счёт.', as_impactBrut:'Влияние на выплаты (брутто)',
  as_logTitlu:'Мои изменения (последние 3 недели)', as_logTitluAdmin:'Изменения ассистента', as_logGol:'Нет изменений за последние 3 недели.',
  as_anulat:'отменено', as_anuleaza:'Отменить', as_confirmAnulare:(n)=>`Отменить это изменение ассистента (${n} ${n===1?'запись':'записей'})? Данные вернутся к прежнему состоянию.`,
  st_praguri:'Пороги уведомлений (справочно)', st_p_medAlerta:'Мед. справка — уведомление', st_p_medAlertaV:'≤ 7 дней осталось',
  st_p_medVal:'Мед. справка — срок действия', st_p_medValV:'6 месяцев', st_p_sarciniRest:'Просроченные задачи',
  st_p_sarciniRestV:'> 48 часов', st_p_intarzieri:'Частые опоздания', st_p_intarzieriV:'≥ 3 за 30 дней',
  st_p_inactiv:'Неактивный участник', st_p_inactivV:'> 2 месяцев без посещений',
  st_jurnalTitle:'Журнал активности — последние действия',

  al_medExpired:(name)=>`Медицинская справка спортсмена ${name} истекла.`,
  al_medSoon:(name,days)=>`Медицинская справка спортсмена ${name} истекает через ${days} дн.`,
  al_medMissing:(name)=>`У активного спортсмена ${name} нет зарегистрированной медицинской справки.`,
  al_lowStock:(name,qty,um,min)=>`Запас «${name}» снизился до ${qty} ${um} (минимум ${min}).`,
  al_staleTask:(desc)=>`Задача «${desc}», зарегистрированная более 48 часов назад, не решена.`,
  al_openTask:(desc)=>`Задача «${desc}» ожидает выполнения.`,
  al_typeMedical:'Медицина', al_typeInventory:'Инвентарь', al_typeTask:'Задача',
  al_frequentLate:(name,count)=>`Спортсмен ${name} опаздывал ${count} раз(а) за последние 30 дней.`,
  nav_statistici:'Статистика игроков',
},
};

/* ══════════════════════ I18N — BSKT Cup (completări și înlocuiri) ══════════════════════ */
Object.assign(ENUM_RU, {
  'căpitan':'капитан', 'jucător':'игрок', 'rezervă':'запасной', 'arbitru':'арбитр',
  'victorie':'победа', 'înfrângere':'поражение',
  'avertisment':'предупреждение', 'fault tehnic':'технический фол', 'fault antisportiv':'неспортивный фол', 'descalificare':'дисквалификация',
  'Maiou':'Майка', 'Maiouri':'Майки', 'Maiou bordo':'Майка бордо', 'Maiou verde':'Зелёная майка', 'Șort bordo':'Шорты бордо', 'Șort verde':'Зелёные шорты',
  'Maiouri bordo':'Майки бордо', 'Maiouri verzi':'Зелёные майки', 'Șorturi bordo':'Шорты бордо', 'Șorturi verzi':'Зелёные шорты',
  'Bordo':'Бордо', 'Verde':'Зелёный', 'Mingi baschet 3×3':'Мячи 3×3',
  'Joc dur':'Грубая игра', 'Fără legitimație':'Без удостоверения', 'Lipsă echipament':'Нет экипировки', 'Comportament nesportiv':'Неспортивное поведение',
});
Object.assign(I18N.ro, {
  st_rolValue:'Administrator', dl_title:'Loturile zilei', dl_btn:'Completează loturile zilei', dl_btnSub:'Un lot pe echipă, aplicat tuturor meciurilor ei din această zi care nu au încă jucători.', dl_sub:'Fiecare echipă joacă de obicei toată seara cu același lot: completați-l o dată și se aplică automat tuturor meciurilor ei fără jucători din această zi. Meciurile care au deja lot nu sunt modificate; un meci anume se poate corecta apoi din editorul meciului. Plățile se calculează automat.', dl_aplica:'Aplică', dl_seAplicaLa:(n)=>`Se aplică la ${n} ${plural(n,'mt_meciuriSuffix','ro')}:`, dl_salveaza:'Salvează loturile', dl_nimic:'Toate meciurile din această zi au deja loturile completate.', dl_conflict:(p,ora,a,b)=>`${p} apare în ambele echipe la meciul de la ${ora} (${a} – ${b}). Corectați unul dintre loturi.`, sx_faraLotAvert:(n)=>`Fără lot completat: ${n} ${plural(n,'mt_meciuriSuffix','ro')} cu scor. Clasamentul echipelor le include, dar statisticile jucătorilor și căpitanilor nu, până nu completați lotul. Zile:`, mt_lotDinUltimul:(d,opp)=>`Lot propus: cel din ultimul meci (${d}, cu ${opp}). Corectați dacă s-a schimbat.`, mt_lotDinEchipa:'Lot propus din componența echipei (nu există un meci anterior cu lot).', sh_faraPersonal:'Nu există personal de serviciu în listă, deci schimbul nu poate fi pornit. Un administrator adaugă numele în Setări → Personal de serviciu.', mt_faraLotAvert:(n)=>`Fără lot completat: ${n} ${plural(n,'mt_meciuriSuffix','ro')} cu scor. Jucătorii din aceste meciuri nu primesc plată până nu completați lotul. Zile:`, mt_faraLotCard:'Meci jucat fără lot: jucătorii nu sunt plătiți până nu se completează lotul.', mt_completeazaLot:'Completează lotul', pl_tabArbitri:'Arbitri', sh_updateBalls:'Actualizează mingi și ore', ar_oraStart:'Început', ar_oraStop:'Sfârșit', ar_interval:'Interval', ar_ore:'Ore', ar_editOre:'Ore', ar_faraOre:'fără ore', ar_singur:'singur', ar_inDoi:'în doi', ar_peste2:'>2 arbitri', ar_needAmbeleOre:'Completați atât ora de început, cât și ora de sfârșit.', ar_confirmAlTreilea:(n)=>`În această zi arbitrează deja ${n}. De regulă sunt cel mult doi arbitri pe zi — adăugați totuși un al treilea?`, ar_regulaPlata:(zi,ore,ora)=>`Un singur arbitru în ziua respectivă: ${zi} lei/zi (${ore} ore). Doi arbitri: fiecare primește ${ora} lei × orele arbitrate (${ore} h = ${ora*ore} lei).`, ar_zile:'Zile', ar_zileSingur:'Zile singur', ar_zileDoi:'Zile în doi', ar_oreDoi:'Ore (în doi)', ar_dePlata:'De plătit', ar_obsLipsa:(n)=>`${n} ${plural(n,'pa_expiraLa','ro')} în doi fără ore completate`, ar_obsPeste2:(n)=>`${n} ${plural(n,'pa_expiraLa','ro')} cu peste 2 arbitri`, ar_avertOreLipsa:(n)=>`${n} ${plural(n,'pa_expiraLa','ro')} cu doi arbitri nu au ora de început/sfârșit completată — se plătesc 0 până la completare (Arbitraj → Ore).`, ar_singurZi:'Singur toată ziua', ar_cu:'Cu', ar_tarifZi:(zi)=>`tarif zi ${zi}`, ar_niciunArbitru:'Niciun arbitru în perioada aleasă.', ar_hint:'Apăsați pe un arbitru pentru detaliile pe zile. Orele se completează în Arbitraj sau din tabloul de bord, la schimb.', ar_tip:'Tip zi', ar_detaliiZile:'Detalii pe zile', ar_tarifeTitle:'Tarife arbitri', ar_tZi:'Arbitru singur — lei/zi', ar_tOreZi:'Ore într-o zi completă', ar_tOra:'Doi arbitri — lei/oră fiecare', re_luna:'Lună (setează perioada)', re_intervalPersonalizat:'Interval personalizat', mp_anAnterior:'Anul anterior', mp_anUrmator:'Anul următor', mp_lunaAnterioara:'Luna anterioară', mp_lunaUrmatoare:'Luna următoare', mp_lunaCurenta:'Luna curentă', mp_inregistrari:'înregistrări', sx_perioada:'Perioada aleasă', sx_siLa:'și la', sx_echipeScurt:'echipe', sx_tabEchipe:'Clasament echipe', sx_ldWin:'Cel mai bun win rate', sx_ldPm:'Cel mai bun +/−', sx_ldActiv:'Cele mai multe meciuri', sx_ldCap:'Cel mai bun căpitan', sx_caCapitan:'ca căpitan', sx_capitanVM:'Căpitan V/M', sx_meciuriCapitan:'Meciuri căpitan', sx_niciunJucator:'Niciun jucător nu corespunde filtrelor.', sx_sortWin:'Sortare: win rate ↓', sx_sortVictorii:'Sortare: victorii ↓', sx_sortPm:'Sortare: +/− ↓', sx_sortRating:'Sortare: rating ↓', sx_minMeciuri:(n)=>`Minim ${n} meciuri`, sx_oriceNrMeciuri:'Orice nr. de meciuri', sx_hintEchipe:'Apăsați pe o echipă pentru a vedea statisticile jucătorilor ei.', sx_hintRand:'Apăsați pe un jucător pentru profil. Liderii de sus iau în calcul doar jucătorii cu minim 10 meciuri.', pl_th2_net:'Net / jucător', pl_th2_brut:'Brut necesar', pl_th2_ret:'Reținere 15%', pl_th2_netRamas:'Net rămas', pl_sumeMdl:'Sume în MDL', pl_th_victorii:'Victorii', pl_th_infrangeri:'Înfrângeri', pl_th_netJucator:'Net / jucător (MDL)', pl_th_coef:'Coef. vs bază', pl_th_brutNecesar:'Brut necesar (MDL)', pl_th_retinere15:'Reținere 15% (MDL)', pl_th_netRamas:'Net rămas (MDL)', pl_th_observatie:'Observație', pl_th_dePlataBrut:'De plătit (brut)', pl_dePlataTotalBrut:'Total de plătit (brut) în perioadă', pl_sortBrut:'Sortare: brut ↓', pl_obsCapitan:'Bonus de leadership inclus', pl_obsRezerva:'Rezervă egală cu jucătorul; nu penalizăm rotația', pl_obsBaza:'Jucător de bază', pl_obsRetinut:'Reținut din plată', pl_tabJucatori:'Jucători', pl_tabEchipe:'Pe echipe', pl_tabTarife:'Tarife', pl_dePlataTotal:'Total de plătit în perioadă', pl_cauta:'Caută jucător sau echipă…', pl_arataZile:'Coloane pe zile', pl_sortNume:'Sortare: nume', pl_sortDePlata:'Sortare: de plătit ↓', pl_sortNet:'Sortare: net ↓', pl_sortMeciuri:'Sortare: meciuri ↓', pl_sortDed:'Sortare: deduceri ↓', pl_sortEchipa:'Sortare: echipă', pl_tipVI:'Victorii–înfrângeri', pl_hintRand:'Apăsați pe un jucător pentru a vedea fiecare meci și calculul plății. Coef. vs bază = media sumei pe meci împărțită la baza (jucător, înfrângere). De plătit = brutul necesar minus deducerile.', pl_detMeciuri:'Meciurile din perioadă', pl_detCalcul:'Calculul plății', pl_deschideProfil:'Deschide profilul', pl_echipeHint:'Apăsați pe o echipă pentru a vedea plățile jucătorilor ei.', pa_countSuffix:["jucător", "jucători"], mt_meciuriSuffix:["meci", "meciuri"], an_countSuffix:["sesiune", "sesiuni"], ve_countSuffix:["eliberare", "eliberări"], ta_countSuffix:["sarcină", "sarcini"], sp_operatiuni:["operațiune", "operațiuni"], sp_countSuffix:["înregistrare", "înregistrări"], pt_countSuffix:["pauză înregistrată", "pauze înregistrate"], pl_zile:["zi de joc", "zile de joc"], ob_countSuffix:["observație", "observații"], le_countSuffix:["înregistrare", "înregistrări"], iv_lowStock:["articol sub stocul minim admis.", "articole sub stocul minim admis."], fp_countSuffix:["sancțiune înregistrată", "sancțiuni înregistrate"], da_categorii:["categorie", "categorii"], da2_countSuffix:["daună înregistrată", "daune înregistrate"], arb_countSuffix:["arbitru", "arbitri"], ar_countSuffix:["eliberare", "eliberări"], pa_expiraLa:["zi", "zile"], cal_ziuaPrecedenta:'Ziua precedentă', cal_ziuaUrmatoare:'Ziua următoare', cal_faraMeciuri:'fără meciuri', cal_jocAnterior:'ziua de joc anterioară', cal_jocUrmator:'următoarea zi de joc', cal_cuMeciuri:'zile cu meciuri', cal_azi:'Azi', te_lot:'Lotul echipei', te_cautaJucator:'Caută jucătorul după nume, echipă sau rating…', te_capitanRating:'Căpitan = cel mai mare rating', te_mutatDin:'mutat din', te_faraNr:'fără nr.', te_scoate:'Scoate', te_adauga:'Adaugă jucător în lot', te_vorFiScosi:'Vor fi scoși din echipă la salvare', te_notaNr:'Numărul în echipă (1–4) este cel din fișa personală. O echipă poate avea mai mulți căpitani; la fiecare meci se alege căpitanul din lot. Jucătorii mutați din altă echipă își schimbă echipa la salvare.', te_errNume:'Denumirea echipei este obligatorie.', te_errNrDublu:'Doi jucători au același număr.', te_errDoiCapitani:'Echipa poate avea un singur căpitan.', te_altaCuloare:'Altă culoare', te_sterge:'Șterge echipa', te_stergeBlocat:'Echipa are meciuri înregistrate și nu poate fi ștearsă — marcați-o inactivă.', te_confirmSterge:(n)=>`Ștergeți echipa ${n}? Jucătorii ei rămân în registru, fără echipă.`, ec_numeExista:'Există deja o echipă cu acest nume.', pt_confirmLunga:(m)=>`Pauza durează ${Math.floor(m/60)} h ${m%60} min (trece peste miezul nopții?). Salvați așa?`, ve_stocInsuficient:(n)=>`În stoc sunt doar ${n} buc. din această mărime. Eliberați totuși (stocul va deveni negativ)?`, re_sect_participanti:'Rapoarte privind jucătorii', act_s_meciuri:'Meciuri', act_echipaA:'Echipa A', act_echipaB:'Echipa B', act_scor:'Scor', act_platou:'Teren', act_cartonas:'Sancțiune', nav_participanti:'Jucători', nav_echipe:'Echipe', nav_meciuri:'Meciuri', nav_plati:'Plăți', nav_statistici:'Statistici',
  da_stat_activi:'Jucători activi', da_stat_meciuri:'Meciuri azi', da_stat_meciuriSub:'Săptămâna aceasta',
  pa_title:'Jucători', pa_sub:'Registrul jucătorilor BSKT Cup — fișa personală, echipa și istoricul fiecăruia.',
  pa_addTitle:'Înregistrare jucător nou', pa_btnAdd:'+ Adaugă jucător', pa_none:'Niciun jucător găsit.',   pa_editTitle:'Modifică fișa jucătorului', pa_deleteBtn:'Șterge jucător', pa_deleteTitle:'Șterge jucătorul din registru', pa_fisa:'Fișa jucătorului',
  pa_restFisa:'Restul câmpurilor din fișa personală (IDNP, act, contacte, istoric sportiv, acorduri) se completează în profil.',
  pa_toateEchipele:'Toate echipele', pa_sortEchipa:'Echipă și număr', pa_sortRating:'Rating (descrescător)',
  pa_searchPh:'Caută după nume, echipă, club, telefon sau IDNP…',
  ec_title:'Echipe', ec_sub:'Echipele BSKT Cup, componența și bilanțul lor (victorii–înfrângeri, diferența de puncte pe meci).',
  ec_addTitle:'Echipă nouă', ec_nume:'Denumire', ec_numePh:'ex. Orbit Basket', ec_culoare:'Culoare', ec_culoareHex:'Culoare (hex, ex. #8E2236)',
  ed_edit:'Editează', ed_editTitle:'Corectează înregistrarea (doar administrator)', ed_needParticipant:'Alegeți persoana.', ed_needField:(f)=>`Completați câmpul „${f}”.`, ed_badNumber:(f)=>`Valoare invalidă pentru „${f}”.`, ed_badDate:(f)=>`Dată invalidă pentru „${f}”.`, ed_noPermission:'nu aveți permisiunea necesară.', ed_sumaJucator:'Sumă jucător (MDL)', ed_sumaAntrenor:'Sumă antrenor (MDL)', ed_actiuni:'Acțiuni întreprinse', ed_dataSolutionare:'Data soluționării', ed_faraJucator:'— fără jucător (subiect general) —', ed_inventarHint:'Aici se corectează datele articolului și stocul inițial. Intrările și ieșirile se corectează din formularul de mișcări de mai sus, ca să rămână în istoric.', mt_editTitle:'Editează meciul', mt_addSlot:'jucător', mt_prelungiri:'Prelungiri (OT)', mt_prelungiriDa:'Decis în prelungiri', mt_loturi:'Loturi', mt_rosterHint:'Lotul stabilește plățile: la salvare, plata fiecărui jucător se recalculează după tarifele valabile la data meciului.', mt_siteLocked:'Data, ora, echipele și scorul vin de pe 3x3.bsktcup.com și nu se modifică aici. Numărul, terenul, arbitrul, observațiile și loturile se pot corecta.',
  mt_dupaMiezulNoptii:'după miezul nopții', mt_dupaMiezulNoptiiTitlu:(zi,urm)=>`Jucat pe ${urm}, după miezul nopții. Face parte din ziua de joc ${zi} (seara care a început la 18:00).`, ec_forma:'Formă', ec_formaV:'V', ec_formaI:'Î', ec_puncteTitlu:'Puncte marcate : primite', mt_dinSiteTitlu:'Rezultat oficial preluat automat de pe 3x3.bsktcup.com', mt_programat:'Programat', mt_syncSursa:'Rezultatele se preiau automat de pe', mt_syncUltima:'ultima sincronizare', mt_syncNiciodata:'încă nesincronizat', mt_syncAcum:'Sincronizează acum', mt_syncRuleaza:'Se sincronizează…', mt_syncEroare:'Sincronizarea a eșuat:',
  ec_btnAdd:'+ Creează echipa', ec_perMeci:'meci', ec_faraMeciuri:'Fără meciuri încă', ec_faraJucatori:'Niciun jucător în echipă.',
  ec_adaugaJucator:'Adaugă un jucător…', ec_edit:'Editează', ec_ramaneActiva:'Echipa rămâne activă? (OK = da, Anulează = inactivă)',
  ec_faraEchipa:'Fără echipă',
  mt_title:'Meciuri', mt_sub:'Meciurile 3×3 ale zilei: echipele, componența (căpitan / jucători / rezervă) și scorul. Plata fiecărui jucător se calculează automat din tarife.',
  mt_ziua:'Ziua de joc', mt_platiZi:'Plăți nete în ziua aleasă', mt_addTitle:'Înregistrare meci',
  mt_nr:'Meci #', mt_ora:'Ora', mt_teren:'Teren', mt_echipaA:'Echipa A', mt_echipaB:'Echipa B', mt_scor:'Scor (opțional, se poate completa după meci)',
  mt_altiJucatori:'Alți jucători', mt_regulaCapitan:'Căpitanul se propune automat: jucătorul cu cel mai mare rating din lot. Poate fi schimbat manual.',
  mt_btnSave:'Salvează meciul', mt_none:'Niciun meci înregistrat în această zi.', mt_faraLot:'Lot neînregistrat',
  mt_scorBtn:'Scor', mt_needTeams:'Alegeți două echipe diferite.', mt_needPlayers:'Fiecare echipă are nevoie de cel puțin 3 jucători.',
  mt_unCapitan:'O echipă poate avea un singur căpitan în meci.', mt_dublura:'Același jucător apare de două ori în meci.',
  mt_egal:'În 3×3 nu există egalitate — corectați scorul.', mt_confirmDelete:(n)=>`Ștergeți meciul #${n??''} împreună cu loturile și plățile lui?`,
  pl_title:'Plăți', pl_sub:'Remunerarea echipelor — net și brut (15%). Pentru freelanceri compania plătește brutul necesar (jucătorul achită reținerea de 15% și rămâne cu netul); pentru ceilalți plătește netul. Deducerile (spălătorie, daune) se scad din suma de plată.',
  pl_saptCurenta:'Săptămâna curentă', pl_saptTrecuta:'Săptămâna trecută', pl_lunaCurenta:'Luna curentă',
  pl_meciuri:'Meciuri jucate', pl_faraScor:'fără scor', pl_jucatori:'Jucători plătiți', pl_fondNet:'Fond net (MDL)', pl_brut:'Brut',
  pl_retinere:'Reținere 15%', pl_deduceri:'Deduceri', pl_deduceriSub:'spălătorie · daune · antrenamente', pl_maxim:'Plata maximă',
  pl_tabel:'Plăți pe jucător', pl_none:'Nicio înregistrare în perioada aleasă.', pl_total:'TOTAL',
  pl_th_jucator:'Jucător', pl_th_echipa:'Echipa', pl_th_m:'Meciuri', pl_th_v:'V', pl_th_i:'Î', pl_th_cap:'Căp.', pl_th_rez:'Rez.',
  pl_th_net:'Net', pl_th_ret:'Reținere', pl_th_brut:'Brut', pl_th_ded:'Deduceri', pl_th_dePlata:'De plătit', pl_th_rol:'Rol',
  pl_tarifeTitle:'Tarife în vigoare (net pe meci)', pl_tarifeSub:'Brut necesar = net ÷ 0,85; reținerea de 15% se calculează automat. Fiecare meci păstrează tariful din ziua lui.',
  pl_victorie:'Victorie', pl_infrangere:'Înfrângere', pl_istoric:'Tarife valabile din', pl_tarifNou:'Tarife noi',
  pl_valabilDeLa:'Valabile de la', pl_retinerePct:'Reținere (%)', pl_salveazaTarife:'Salvează tarifele', pl_recalc:'Recalculează plățile de la această dată',
  pl_completeazaTot:'Completați toate cele 6 sume.', pl_confirmTarife:(d)=>`Salvați tarifele noi valabile de la ${d}?`,
  pl_confirmRecalc:(d)=>`Recalculați plățile tuturor meciurilor de la ${d} după tarifele în vigoare?`,
  sx_title:'Statistici', sx_sub:'Clasamentul echipelor, statisticile jucătorilor și ale căpitanilor, calculate din meciurile înregistrate.',
  sx_tot:'Tot timpul', sx_interval:'Interval', sx_aplica:'Aplică', sx_ceaMaiBuna:'Cea mai bună echipă', sx_clasament:'Clasament echipe',
  sx_winRate:'Win rate', sx_marcate:'Marcate', sx_primite:'Primite', sx_difMeci:'Dif./meci', sx_jucatori:'Jucători',
  sx_pmHint:'+/− = diferența medie de puncte a echipei în meciurile jucătorului', sx_rating:'Rating', sx_echipe:'Echipe',
  sx_capitan:'Căpitan', sx_capitani:'Căpitani',
  st_loading2:'Se încarcă…',
  fi_title:'Fișa personală a sportivului', fi_btnPdf:'Fișa PDF', fi_foto:'Fotografie', fi_incarcaFoto:'Încarcă fotografie', fi_fotoMare:'Fotografia depășește 5 MB.',
  fi_completare:'Câmpuri completate', fi_da:'Da', fi_patronimic:'Patronimic',
  fi_numeComplet:'nume, prenume, patronimic', fi_locNastere:'locul nașterii', fi_domiciliu:'domiciliu, reședința', fi_idnp:'IDNP',
  fi_telefon:'telefon de contact', fi_contactRezerva:'contact rezervă (caz excepțional)', fi_persoanaContact:'persoana de contact',
  fi_serieAct:'seria BI', fi_nrAct:'număr document', fi_dataEmiterii:'data emiterii', fi_stagiu:'stagiu sportiv (ani)',
  fi_locMunca:'locul de muncă permanent', fi_functia:'funcția', fi_profil:'profil/specialitate de activitate',
  fi_club:'apartenența club, școală sportivă', fi_echipa:'Echipa BSKT Cup', fi_nrEchipa:'număr echipă (1–4)', fi_nrEchipaShort:'Nr.',
  fi_statutEchipa:'statut echipă (căpitan, jucător, arbitru)', fi_statutEchipaShort:'Rol', fi_clasament:'clasament', fi_categoria:'categoria (maestru, candidat…)',
  fi_primulAntrenor:'primul antrenor (nume, prenume)', fi_recomandator:'recomandator (nume, prenume)', fi_garant:'garant integritate (nume, prenume)',
  fi_inaltime:'înălțimea (cm)', fi_greutate:'greutatea jucătorului (kg)', fi_marime:'mărime echipament',
  fi_rezultate:'rezultate în sport, performanțe (campion MD, premiant campionate internaționale)',
  fi_traumatisme:'traumatisme / boli cronice', fi_contraindicatii:'contraindicații medicale', fi_altSport:'practicarea altui gen de sport',
  fi_experienta:'experiența competiții sportive / profesioniste', fi_contactePariuri:'contacte implicate în pariuri pe sport', fi_experientaPariere:'experiența personală pariere pe sport',
  fi_caracteristica:'caracteristica generală a jucătorului (de la agentul sportiv sau recomandator)',
  fi_informat:'informat despre cerințele și regulile de securitate în activitatea sportivă', fi_acord:'și-a exprimat acordul pentru prelucrarea datelor cu caracter personal',
  fi_comentarii:'comentarii', fi_pdfTitlu:'FIȘA PERSONALĂ', fi_pdfSub:'a sportivului · BSKT Cup 3×3', fi_pdfGenerat:'generat la',
  stx_personal:'Personal de serviciu', stx_personalSub:'Numele dintre care se alege la pornirea unui schimb pe contul de locație.',
  stx_numeAngajat:'Nume și prenume', stx_numeAngajatPh:'ex. Popescu Ion', stx_scoate:'Scoate', stx_personalNone:'Niciun angajat adăugat încă — adăugați cel puțin unul pentru a putea porni schimburi.',
  stx_confirmDezactivare:(n)=>`Scoateți ${n} din personalul de serviciu? Istoricul rămâne în registru.`,
  stx_terenuri:'Terenuri', stx_antrenori:'Antrenori', stx_listaVirgula:'Listă separată prin virgulă', stx_antrenoriPh:'ex. Oleg Pravdiuk, Oleg Dical',
  stx_faraAntrenori:'Adăugați antrenori în Setări',
  sh_refHelp:'Salvează numele și terenul acum. Numărul mingilor poate fi completat aici mai târziu.', sh_venue:'Teren',
  sh_matchesTitle:'Meciurile zilei', sh_matchesHelp:'Înregistrează meciurile, loturile și scorul — plățile jucătorilor se calculează automat.', sh_matchesOpen:'Deschide meciurile',
  ar_sub:'Arbitrii de serviciu și mingile de baschet eliberate — se scad automat din inventar.', ar_turneu:'Teren', ar_th_turneu:'Teren',
  fp_sub:'Sancțiunile acordate jucătorilor: avertismente, faulturi tehnice și antisportive, descalificări.', fp_platou:'Teren', fp_th_platou:'Teren',
  fp_cartonas:'Sancțiune', fp_th_cartonas:'Sancțiune', fp_reportTitle:'Clasament sancțiuni', fp_reportSub:'Jucătorii după numărul de sancțiuni primite.',
  da2_inventarAfectatPh:'ex. Panou baschet', da2_naturaPh:'ex. Plasă ruptă',
  an_sub:'Sesiuni de antrenament individual — 100 MDL/sesiune de la jucător (se scade din plată), 200 MDL/sesiune pentru antrenor.',
  re_m_mingi:'Mingi eliberate', re_sect_meciuri:'Meciuri', re_r_meciuri:'Meciuri înregistrate', re_r_meciuriFaraScor:'Meciuri fără scor',
  re_r_zileJoc:'Zile de joc', re_r_echipe:'Echipe care au jucat', re_r_sanctiuni:'Sancțiuni Fair Play',
  err_save:'Salvarea a eșuat:', err_update:'Actualizarea a eșuat:', err_delete:'Ștergerea a eșuat:', err_load:'Încărcarea a eșuat:', err_noPerm:'nu aveți permisiunea necesară.',
});
Object.assign(I18N.ru, {
  st_rolValue:'Администратор', dl_title:'Составы дня', dl_btn:'Заполнить составы дня', dl_btnSub:'Один состав на команду для всех её матчей этого дня, где ещё нет игроков.', dl_sub:'Обычно команда играет весь вечер одним составом: заполните его один раз, и он применится ко всем её матчам этого дня без игроков. Матчи, где состав уже есть, не меняются; отдельный матч можно потом исправить в редакторе матча. Выплаты считаются автоматически.', dl_aplica:'Применить', dl_seAplicaLa:(n)=>`Применяется к ${n} ${plural(n,'mt_meciuriSuffix','ru')}:`, dl_salveaza:'Сохранить составы', dl_nimic:'У всех матчей этого дня составы уже заполнены.', dl_conflict:(p,ora,a,b)=>`${p} указан в обеих командах в матче в ${ora} (${a} – ${b}). Исправьте один из составов.`, sx_faraLotAvert:(n)=>`Без состава: ${n} ${plural(n,'mt_meciuriSuffix','ru')} со счётом. Таблица команд их учитывает, а статистика игроков и капитанов — нет, пока состав не заполнен. Дни:`, mt_lotDinUltimul:(d,opp)=>`Предложен состав из последнего матча (${d}, против ${opp}). Исправьте, если он изменился.`, mt_lotDinEchipa:'Состав предложен по списку команды (нет прошлого матча с составом).', sh_faraPersonal:'В списке нет дежурного персонала, поэтому смену нельзя начать. Администратор добавляет имена в Настройки → Дежурный персонал.', mt_faraLotAvert:(n)=>`Без состава: ${n} ${plural(n,'mt_meciuriSuffix','ru')} со счётом. Игроки этих матчей не получат оплату, пока состав не заполнен. Дни:`, mt_faraLotCard:'Матч сыгран без состава: игрокам не начисляется оплата, пока состав не заполнен.', mt_completeazaLot:'Заполнить состав', pl_tabArbitri:'Арбитры', sh_updateBalls:'Обновить мячи и часы', ar_oraStart:'Начало', ar_oraStop:'Конец', ar_interval:'Интервал', ar_ore:'Часы', ar_editOre:'Часы', ar_faraOre:'без часов', ar_singur:'один', ar_inDoi:'вдвоём', ar_peste2:'>2 арбитров', ar_needAmbeleOre:'Укажите и время начала, и время окончания.', ar_confirmAlTreilea:(n)=>`В этот день уже судят ${n}. Обычно не больше двух арбитров в день — всё равно добавить третьего?`, ar_regulaPlata:(zi,ore,ora)=>`Один арбитр за день: ${zi} лей/день (${ore} ч). Два арбитра: каждый получает ${ora} лей × отсуженные часы (${ore} ч = ${ora*ore} лей).`, ar_zile:'Дни', ar_zileSingur:'Дни один', ar_zileDoi:'Дни вдвоём', ar_oreDoi:'Часы (вдвоём)', ar_dePlata:'К выплате', ar_obsLipsa:(n)=>`${n} ${plural(n,'pa_expiraLa','ru')} вдвоём без указанных часов`, ar_obsPeste2:(n)=>`${n} ${plural(n,'pa_expiraLa','ru')} с более чем 2 арбитрами`, ar_avertOreLipsa:(n)=>`${n} ${plural(n,'pa_expiraLa','ru')} с двумя арбитрами без времени начала/окончания — оплата 0 до заполнения (Арбитраж → Часы).`, ar_singurZi:'Один весь день', ar_cu:'С', ar_tarifZi:(zi)=>`ставка за день ${zi}`, ar_niciunArbitru:'Нет арбитров за выбранный период.', ar_hint:'Нажмите на арбитра, чтобы увидеть детали по дням. Часы заполняются в Арбитраже или на панели смены.', ar_tip:'Тип дня', ar_detaliiZile:'Детали по дням', ar_tarifeTitle:'Ставки арбитров', ar_tZi:'Один арбитр — лей/день', ar_tOreZi:'Часов в полном дне', ar_tOra:'Два арбитра — лей/час каждому', re_luna:'Месяц (задаёт период)', re_intervalPersonalizat:'Свой период', mp_anAnterior:'Предыдущий год', mp_anUrmator:'Следующий год', mp_lunaAnterioara:'Предыдущий месяц', mp_lunaUrmatoare:'Следующий месяц', mp_lunaCurenta:'Текущий месяц', mp_inregistrari:'записей', sx_perioada:'Выбранный период', sx_siLa:'также в', sx_echipeScurt:'команд', sx_tabEchipe:'Таблица команд', sx_ldWin:'Лучший винрейт', sx_ldPm:'Лучший +/−', sx_ldActiv:'Больше всего матчей', sx_ldCap:'Лучший капитан', sx_caCapitan:'капитаном', sx_capitanVM:'Капитан П/М', sx_meciuriCapitan:'Матчи капитаном', sx_niciunJucator:'Нет игроков по этим фильтрам.', sx_sortWin:'Сортировка: винрейт ↓', sx_sortVictorii:'Сортировка: победы ↓', sx_sortPm:'Сортировка: +/− ↓', sx_sortRating:'Сортировка: рейтинг ↓', sx_minMeciuri:(n)=>`Минимум ${n} матчей`, sx_oriceNrMeciuri:'Любое число матчей', sx_hintEchipe:'Нажмите на команду, чтобы увидеть статистику её игроков.', sx_hintRand:'Нажмите на игрока, чтобы открыть профиль. Лидеры сверху учитывают только игроков с минимум 10 матчами.', pl_th2_net:'Нетто / игрок', pl_th2_brut:'Необходимое брутто', pl_th2_ret:'Удержание 15%', pl_th2_netRamas:'Остаток нетто', pl_sumeMdl:'Суммы в MDL', pl_th_victorii:'Победы', pl_th_infrangeri:'Поражения', pl_th_netJucator:'Нетто / игрок (MDL)', pl_th_coef:'Коэф. к базе', pl_th_brutNecesar:'Необходимое брутто (MDL)', pl_th_retinere15:'Удержание 15% (MDL)', pl_th_netRamas:'Остаток нетто (MDL)', pl_th_observatie:'Примечание', pl_th_dePlataBrut:'К выплате (брутто)', pl_dePlataTotalBrut:'Итого к выплате (брутто) за период', pl_sortBrut:'Сортировка: брутто ↓', pl_obsCapitan:'Включён бонус за лидерство', pl_obsRezerva:'Запасной наравне с игроком; ротацию не штрафуем', pl_obsBaza:'Базовый игрок', pl_obsRetinut:'Удержано из выплаты', pl_tabJucatori:'Игроки', pl_tabEchipe:'По командам', pl_tabTarife:'Ставки', pl_dePlataTotal:'Итого к выплате за период', pl_cauta:'Поиск игрока или команды…', pl_arataZile:'Колонки по дням', pl_sortNume:'Сортировка: имя', pl_sortDePlata:'Сортировка: к выплате ↓', pl_sortNet:'Сортировка: нетто ↓', pl_sortMeciuri:'Сортировка: матчи ↓', pl_sortDed:'Сортировка: вычеты ↓', pl_sortEchipa:'Сортировка: команда', pl_tipVI:'Победы–поражения', pl_hintRand:'Нажмите на игрока, чтобы увидеть каждый матч и расчёт выплаты. Коэф. к базе = средняя сумма за матч, делённая на базу (игрок, поражение). К выплате = необходимое брутто минус вычеты.', pl_detMeciuri:'Матчи за период', pl_detCalcul:'Расчёт выплаты', pl_deschideProfil:'Открыть профиль', pl_echipeHint:'Нажмите на команду, чтобы увидеть выплаты её игроков.', pa_countSuffix:["игрок", "игрока", "игроков"], mt_meciuriSuffix:["матч", "матча", "матчей"], an_countSuffix:["сессия", "сессии", "сессий"], ve_countSuffix:["выдача", "выдачи", "выдач"], ta_countSuffix:["задача", "задачи", "задач"], sp_operatiuni:["операция", "операции", "операций"], sp_countSuffix:["запись", "записи", "записей"], pt_countSuffix:["перерыв зарегистрирован", "перерыва зарегистрировано", "перерывов зарегистрировано"], pl_zile:["игровой день", "игровых дня", "игровых дней"], ob_countSuffix:["замечание", "замечания", "замечаний"], le_countSuffix:["запись", "записи", "записей"], iv_lowStock:["товар ниже допустимого минимума.", "товара ниже допустимого минимума.", "товаров ниже допустимого минимума."], fp_countSuffix:["зарегистрированная санкция", "зарегистрированные санкции", "зарегистрированных санкций"], da_categorii:["категории", "категорий", "категорий"], da2_countSuffix:["случай ущерба", "случая ущерба", "случаев ущерба"], arb_countSuffix:["судья", "судьи", "судей"], ar_countSuffix:["выдача", "выдачи", "выдач"], pa_expiraLa:["день", "дня", "дней"], cal_ziuaPrecedenta:'Предыдущий день', cal_ziuaUrmatoare:'Следующий день', cal_faraMeciuri:'без матчей', cal_jocAnterior:'предыдущий игровой день', cal_jocUrmator:'следующий игровой день', cal_cuMeciuri:'дни с матчами', cal_azi:'Сегодня', te_lot:'Состав команды', te_cautaJucator:'Поиск игрока по имени, команде или рейтингу…', te_capitanRating:'Капитан = самый высокий рейтинг', te_mutatDin:'переходит из', te_faraNr:'без №', te_scoate:'Убрать', te_adauga:'Добавить игрока в состав', te_vorFiScosi:'Будут убраны из команды при сохранении', te_notaNr:'Номер в команде (1–4) — тот же, что в личной карточке. У команды может быть несколько капитанов; капитан матча выбирается в составе на матч. Игроки из другой команды переходят при сохранении.', te_errNume:'Название команды обязательно.', te_errNrDublu:'У двух игроков одинаковый номер.', te_errDoiCapitani:'У команды может быть только один капитан.', te_altaCuloare:'Другой цвет', te_sterge:'Удалить команду', te_stergeBlocat:'У команды есть матчи, её нельзя удалить — отметьте её неактивной.', te_confirmSterge:(n)=>`Удалить команду ${n}? Её игроки останутся в реестре без команды.`, ec_numeExista:'Команда с таким названием уже существует.', pt_confirmLunga:(m)=>`Перерыв длится ${Math.floor(m/60)} ч ${m%60} мин (через полночь?). Сохранить так?`, ve_stocInsuficient:(n)=>`На складе только ${n} шт. этого размера. Всё равно выдать (остаток станет отрицательным)?`, re_sect_participanti:'Отчёты об игроках', act_s_meciuri:'Матчи', act_echipaA:'Команда A', act_echipaB:'Команда B', act_scor:'Счёт', act_platou:'Площадка', act_cartonas:'Санкция', nav_participanti:'Игроки', nav_echipe:'Команды', nav_meciuri:'Матчи', nav_plati:'Выплаты', nav_statistici:'Статистика',
  da_stat_activi:'Активные игроки', da_stat_meciuri:'Матчи сегодня', da_stat_meciuriSub:'За эту неделю',
  pa_title:'Игроки', pa_sub:'Реестр игроков BSKT Cup — личная карточка, команда и история каждого.',
  pa_addTitle:'Регистрация нового игрока', pa_btnAdd:'+ Добавить игрока', pa_none:'Игроки не найдены.',   pa_editTitle:'Изменить карточку игрока', pa_deleteBtn:'Удалить игрока', pa_deleteTitle:'Удалить игрока из реестра', pa_fisa:'Карточка игрока',
  pa_restFisa:'Остальные поля личной карточки (IDNP, документ, контакты, спортивная история, согласия) заполняются в профиле.',
  pa_toateEchipele:'Все команды', pa_sortEchipa:'Команда и номер', pa_sortRating:'Рейтинг (по убыванию)',
  pa_searchPh:'Поиск по имени, команде, клубу, телефону или IDNP…',
  ec_title:'Команды', ec_sub:'Команды BSKT Cup, их состав и баланс (победы–поражения, разница очков за матч).',
  ec_addTitle:'Новая команда', ec_nume:'Название', ec_numePh:'напр. Orbit Basket', ec_culoare:'Цвет', ec_culoareHex:'Цвет (hex, напр. #8E2236)',
  ed_edit:'Изменить', ed_editTitle:'Исправить запись (только администратор)', ed_needParticipant:'Выберите человека.', ed_needField:(f)=>`Заполните поле «${f}».`, ed_badNumber:(f)=>`Неверное значение в поле «${f}».`, ed_badDate:(f)=>`Неверная дата в поле «${f}».`, ed_noPermission:'нет необходимых прав.', ed_sumaJucator:'Сумма игрока (MDL)', ed_sumaAntrenor:'Сумма тренера (MDL)', ed_actiuni:'Принятые меры', ed_dataSolutionare:'Дата решения', ed_faraJucator:'— без игрока (общая тема) —', ed_inventarHint:'Здесь исправляются данные товара и начальный остаток. Приход и расход исправляются через форму операций выше, чтобы они остались в истории.', mt_editTitle:'Изменить матч', mt_addSlot:'игрок', mt_prelungiri:'Овертайм (OT)', mt_prelungiriDa:'Решён в овертайме', mt_loturi:'Составы', mt_rosterHint:'Состав определяет выплаты: при сохранении выплата каждого игрока пересчитывается по тарифам на дату матча.', mt_siteLocked:'Дата, время, команды и счёт берутся с 3x3.bsktcup.com и здесь не меняются. Номер, площадку, судью, примечания и составы можно исправить.',
  mt_dupaMiezulNoptii:'после полуночи', mt_dupaMiezulNoptiiTitlu:(zi,urm)=>`Сыгран ${urm}, после полуночи. Относится к игровому дню ${zi} (вечер, начавшийся в 18:00).`, ec_forma:'Форма', ec_formaV:'В', ec_formaI:'П', ec_puncteTitlu:'Очки забито : пропущено', mt_dinSiteTitlu:'Официальный результат, автоматически взят с 3x3.bsktcup.com', mt_programat:'Запланирован', mt_syncSursa:'Результаты автоматически берутся с', mt_syncUltima:'последняя синхронизация', mt_syncNiciodata:'ещё не синхронизировано', mt_syncAcum:'Синхронизировать', mt_syncRuleaza:'Синхронизация…', mt_syncEroare:'Синхронизация не удалась:',
  ec_btnAdd:'+ Создать команду', ec_perMeci:'матч', ec_faraMeciuri:'Пока без матчей', ec_faraJucatori:'В команде нет игроков.',
  ec_adaugaJucator:'Добавить игрока…', ec_edit:'Изменить', ec_ramaneActiva:'Команда остаётся активной? (OK = да, Отмена = неактивна)',
  ec_faraEchipa:'Без команды',
  mt_title:'Матчи', mt_sub:'Матчи 3×3 за день: команды, состав (капитан / игроки / запасной) и счёт. Выплата каждому игроку считается автоматически по ставкам.',
  mt_ziua:'Игровой день', mt_platiZi:'Чистые выплаты за день', mt_addTitle:'Регистрация матча',
  mt_nr:'Матч #', mt_ora:'Время', mt_teren:'Площадка', mt_echipaA:'Команда A', mt_echipaB:'Команда B', mt_scor:'Счёт (необязательно, можно внести после матча)',
  mt_altiJucatori:'Другие игроки', mt_regulaCapitan:'Капитан предлагается автоматически: игрок с самым высоким рейтингом в составе. Можно изменить вручную.',
  mt_btnSave:'Сохранить матч', mt_none:'В этот день матчей нет.', mt_faraLot:'Состав не внесён',
  mt_scorBtn:'Счёт', mt_needTeams:'Выберите две разные команды.', mt_needPlayers:'В каждой команде должно быть минимум 3 игрока.',
  mt_unCapitan:'У команды в матче может быть только один капитан.', mt_dublura:'Один и тот же игрок указан дважды.',
  mt_egal:'В 3×3 ничьих нет — исправьте счёт.', mt_confirmDelete:(n)=>`Удалить матч #${n??''} вместе с составами и выплатами?`,
  pl_title:'Выплаты', pl_sub:'Вознаграждение команд — нетто и брутто (15%). Фрилансерам компания выплачивает необходимое брутто (игрок платит 15% и остаётся с нетто); остальным — нетто. Вычеты (прачечная, ущерб) вычитаются из суммы к выплате.',
  pl_saptCurenta:'Текущая неделя', pl_saptTrecuta:'Прошлая неделя', pl_lunaCurenta:'Текущий месяц',
  pl_meciuri:'Сыграно матчей', pl_faraScor:'без счёта', pl_jucatori:'Игроков к выплате', pl_fondNet:'Фонд нетто (MDL)', pl_brut:'Брутто',
  pl_retinere:'Удержание 15%', pl_deduceri:'Вычеты', pl_deduceriSub:'прачечная · ущерб · тренировки', pl_maxim:'Максимальная выплата',
  pl_tabel:'Выплаты по игрокам', pl_none:'Нет записей за выбранный период.', pl_total:'ИТОГО',
  pl_th_jucator:'Игрок', pl_th_echipa:'Команда', pl_th_m:'Матчи', pl_th_v:'П', pl_th_i:'Пор.', pl_th_cap:'Кап.', pl_th_rez:'Зап.',
  pl_th_net:'Нетто', pl_th_ret:'Удержание', pl_th_brut:'Брутто', pl_th_ded:'Вычеты', pl_th_dePlata:'К выплате', pl_th_rol:'Роль',
  pl_tarifeTitle:'Действующие ставки (нетто за матч)', pl_tarifeSub:'Брутто = нетто ÷ 0,85; удержание 15% считается автоматически. Каждый матч сохраняет ставку своего дня.',
  pl_victorie:'Победа', pl_infrangere:'Поражение', pl_istoric:'Ставки действуют с', pl_tarifNou:'Новые ставки',
  pl_valabilDeLa:'Действуют с', pl_retinerePct:'Удержание (%)', pl_salveazaTarife:'Сохранить ставки', pl_recalc:'Пересчитать выплаты с этой даты',
  pl_completeazaTot:'Заполните все 6 сумм.', pl_confirmTarife:(d)=>`Сохранить новые ставки, действующие с ${d}?`,
  pl_confirmRecalc:(d)=>`Пересчитать выплаты всех матчей с ${d} по действующим ставкам?`,
  sx_title:'Статистика', sx_sub:'Таблица команд, статистика игроков и капитанов по внесённым матчам.',
  sx_tot:'За всё время', sx_interval:'Период', sx_aplica:'Применить', sx_ceaMaiBuna:'Лучшая команда', sx_clasament:'Таблица команд',
  sx_winRate:'Винрейт', sx_marcate:'Забито', sx_primite:'Пропущено', sx_difMeci:'Разн./матч', sx_jucatori:'Игроки',
  sx_pmHint:'+/− = средняя разница очков команды в матчах игрока', sx_rating:'Рейтинг', sx_echipe:'Команды',
  sx_capitan:'Капитан', sx_capitani:'Капитаны',
  st_loading2:'Загрузка…',
  fi_title:'Личная карточка спортсмена', fi_btnPdf:'Карточка PDF', fi_foto:'Фото', fi_incarcaFoto:'Загрузить фото', fi_fotoMare:'Фото больше 5 МБ.',
  fi_completare:'Заполнено полей', fi_da:'Да', fi_patronimic:'Отчество',
  fi_numeComplet:'фамилия, имя, отчество', fi_locNastere:'место рождения', fi_domiciliu:'адрес проживания', fi_idnp:'IDNP',
  fi_telefon:'контактный телефон', fi_contactRezerva:'резервный контакт (экстренный случай)', fi_persoanaContact:'контактное лицо',
  fi_serieAct:'серия удостоверения', fi_nrAct:'номер документа', fi_dataEmiterii:'дата выдачи', fi_stagiu:'спортивный стаж (лет)',
  fi_locMunca:'постоянное место работы', fi_functia:'должность', fi_profil:'профиль/специальность',
  fi_club:'клуб, спортивная школа', fi_echipa:'Команда BSKT Cup', fi_nrEchipa:'номер в команде (1–4)', fi_nrEchipaShort:'№',
  fi_statutEchipa:'статус в команде (капитан, игрок, арбитр)', fi_statutEchipaShort:'Роль', fi_clasament:'рейтинг/место', fi_categoria:'разряд (мастер, кандидат…)',
  fi_primulAntrenor:'первый тренер (ФИО)', fi_recomandator:'рекомендатель (ФИО)', fi_garant:'гарант честности (ФИО)',
  fi_inaltime:'рост (см)', fi_greutate:'вес игрока (кг)', fi_marime:'размер формы',
  fi_rezultate:'спортивные результаты, достижения (чемпион РМ, призёр международных турниров)',
  fi_traumatisme:'травмы / хронические заболевания', fi_contraindicatii:'медицинские противопоказания', fi_altSport:'занятия другим видом спорта',
  fi_experienta:'опыт спортивных / профессиональных соревнований', fi_contactePariuri:'связи, вовлечённые в спортивные ставки', fi_experientaPariere:'личный опыт ставок на спорт',
  fi_caracteristica:'общая характеристика игрока (от агента или рекомендателя)',
  fi_informat:'ознакомлен с требованиями и правилами безопасности', fi_acord:'дал согласие на обработку персональных данных',
  fi_comentarii:'комментарии', fi_pdfTitlu:'ЛИЧНАЯ КАРТОЧКА', fi_pdfSub:'спортсмена · BSKT Cup 3×3', fi_pdfGenerat:'создано',
  stx_personal:'Дежурный персонал', stx_personalSub:'Имена, из которых выбирают при начале смены на аккаунте локации.',
  stx_numeAngajat:'Фамилия и имя', stx_numeAngajatPh:'напр. Попеску Ион', stx_scoate:'Убрать', stx_personalNone:'Сотрудники ещё не добавлены — добавьте хотя бы одного, чтобы начинать смены.',
  stx_confirmDezactivare:(n)=>`Убрать ${n} из дежурного персонала? История останется в реестре.`,
  stx_terenuri:'Площадки', stx_antrenori:'Тренеры', stx_listaVirgula:'Список через запятую', stx_antrenoriPh:'напр. Олег Правдюк, Олег Дикал',
  stx_faraAntrenori:'Добавьте тренеров в Настройках',
  sh_refHelp:'Сохраните имя и площадку сейчас. Количество мячей можно внести здесь позже.', sh_venue:'Площадка',
  sh_matchesTitle:'Матчи дня', sh_matchesHelp:'Вносите матчи, составы и счёт — выплаты игрокам считаются автоматически.', sh_matchesOpen:'Открыть матчи',
  ar_sub:'Дежурные арбитры и выданные баскетбольные мячи — автоматически списываются со склада.', ar_turneu:'Площадка', ar_th_turneu:'Площадка',
  fp_sub:'Санкции игрокам: предупреждения, технические и неспортивные фолы, дисквалификации.', fp_platou:'Площадка', fp_th_platou:'Площадка',
  fp_cartonas:'Санкция', fp_th_cartonas:'Санкция', fp_reportTitle:'Рейтинг санкций', fp_reportSub:'Игроки по количеству полученных санкций.',
  da2_inventarAfectatPh:'напр. Баскетбольный щит', da2_naturaPh:'напр. Порвана сетка',
  an_sub:'Индивидуальные тренировки — 100 MDL/сессия с игрока (вычитается из выплаты), 200 MDL/сессия тренеру.',
  re_m_mingi:'Выдано мячей', re_sect_meciuri:'Матчи', re_r_meciuri:'Внесено матчей', re_r_meciuriFaraScor:'Матчи без счёта',
  re_r_zileJoc:'Игровых дней', re_r_echipe:'Сыгравших команд', re_r_sanctiuni:'Санкции Fair Play',
  err_save:'Не удалось сохранить:', err_update:'Не удалось обновить:', err_delete:'Не удалось удалить:', err_load:'Не удалось загрузить:', err_noPerm:'нет необходимых прав.',
});

let DB = null;
let currentView = 'dashboard';
let currentAdmin = null;      // "Nume Prenume" afișat
let currentAdminId = null;    // uuid din auth.users / administratori
const APP_BUILD = '2026-10-06-bskt-1';
let currentRole = null;       // 'admin' | 'locatie' | 'asistent'
let currentProfileId = null;
let currentArbitruId = null;
let currentShift = null;
let shiftStartPrompt = false;
let adminDemoShiftActive = false;
let dashboardTrainingRows = 1;
let demoShiftArbitrajIds = [];
let dashboardRefereeEditId = null;
function isFullAdmin(){ return currentRole === 'admin'; }
// helper account: players, teams, matches, statistics and payments — read-only, no personal data
function isAsistent(){ return currentRole === 'asistent'; }
function canSeeMoney(){ return isFullAdmin() || isAsistent(); }
// the helper may add/edit matches from Monday of the previous week up to 30 days ahead (the database enforces the same)
function asistentWindowStart(){ return addDays(weekStart(todayISO()), -7); }
function asistentWindowEnd(){ return addDays(todayISO(), 30); }
function inAsistentWindow(day){ return !!day && day >= asistentWindowStart() && day <= asistentWindowEnd(); }
function canOpenMatchEditor(m){ return !isWeekLocked(m.data) && (isFullAdmin() || (isAsistent() && inAsistentWindow(m.data))); }
function hasActiveShift(){ return isFullAdmin() || !!currentShift; }
function activeShiftName(){
  if(isFullAdmin()) return currentAdmin;
  return currentShift?.administrator || currentAdmin;
}
function journalActorName(){
  return isFullAdmin() ? publicAdminName(DB?.administratori.find(a=>a.id===currentAdminId)) : activeShiftName();
}

const LOCATION_REFRESH_WINDOWS = [
  {id:'01', start:60, end:120},
  {id:'04', start:240, end:270},
  {id:'0630', start:390, end:410},
];
let locationRefreshTimer = null;
let locationRefreshChannel = null;
let liveRefreshEvents = [];
let refreshReminderKind = null;

function moldovaClock(now=new Date()){
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone:'Europe/Chisinau', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23',
  }).formatToParts(now).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  return {
    dateKey:`${parts.year}-${parts.month}-${parts.day}`,
    minuteOfDay:Number(parts.hour)*60+Number(parts.minute),
  };
}
function stableReminderMinute(dateKey,window){
  const seed = `${dateKey}:${window.id}`;
  let hash = 2166136261;
  for(let i=0;i<seed.length;i++) hash = Math.imul(hash ^ seed.charCodeAt(i),16777619);
  return window.start + ((hash>>>0) % (window.end-window.start));
}
function showRefreshReminder(kind='reminder'){
  if(isFullAdmin() || isAsistent()) return;
  const box = document.getElementById('location-refresh-reminder');
  if(!box) return;
  refreshReminderKind = kind;
  const required = kind!=='reminder';
  const titleKey = kind==='update' ? 'refresh_updateTitle' : kind==='verify' ? 'refresh_verifyTitle' : 'refresh_reminderTitle';
  const textKey = kind==='update' ? 'refresh_updateText' : kind==='verify' ? 'refresh_verifyText' : 'refresh_reminderText';
  box.classList.toggle('required',required);
  document.getElementById('refresh-reminder-title').textContent = t(titleKey);
  document.getElementById('refresh-reminder-text').textContent = t(textKey);
  document.getElementById('refresh-reminder-refresh').textContent = t('refresh_now');
  document.getElementById('refresh-reminder-close').textContent = t('refresh_close');
  box.classList.add('visible');
}
function hideRefreshReminder(){
  document.getElementById('location-refresh-reminder')?.classList.remove('visible');
  refreshReminderKind = null;
}
function forceFreshReload(){
  const url = new URL(location.href);
  url.searchParams.set('fresh',Date.now());
  location.replace(url.href);
}
function queueLiveRefreshEvent(event){
  if(!event?.id || liveRefreshEvents.some(item=>item.id===event.id)) return;
  liveRefreshEvents.push(event);
  checkLiveRefreshEvents();
}
function checkLiveRefreshEvents(){
  if(isFullAdmin()) return;
  const now = Date.now();
  liveRefreshEvents = liveRefreshEvents.filter(event=>new Date(event.expires_at).getTime()>now);
  const due = liveRefreshEvents.find(event=>{
    let shown = false;
    try{ shown = localStorage.getItem(`bskt-live-refresh:${event.id}`)==='1'; }catch(_error){}
    const shiftAllowed = event.requires_active_shift===false || !!currentShift;
    return !shown && shiftAllowed && new Date(event.scheduled_at).getTime()<=now;
  });
  if(!due) return;
  try{ localStorage.setItem(`bskt-live-refresh:${due.id}`,'1'); }catch(_error){}
  showRefreshReminder('reminder');
}
async function connectLocationRefreshEvents(){
  const { data } = await sb.from('location_refresh_events').select('*').gt('expires_at',new Date().toISOString()).order('scheduled_at');
  (data||[]).forEach(queueLiveRefreshEvent);
  locationRefreshChannel = sb.channel(`location-refresh-${currentAdminId}`)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'location_refresh_events'},payload=>queueLiveRefreshEvent(payload.new))
    .subscribe();
}
function checkLocationRefreshReminder(){
  if(isFullAdmin()) return;
  checkLiveRefreshEvents();
  if(!currentShift) return;
  const clock = moldovaClock();
  for(const window of LOCATION_REFRESH_WINDOWS){
    const scheduledMinute = stableReminderMinute(clock.dateKey,window);
    const storageKey = `bskt-refresh-reminder:${clock.dateKey}:${window.id}`;
    let alreadyShown = false;
    try{ alreadyShown = localStorage.getItem(storageKey)==='1'; }catch(_error){}
    if(!alreadyShown && clock.minuteOfDay>=scheduledMinute && clock.minuteOfDay<window.end){
      try{ localStorage.setItem(storageKey,'1'); }catch(_error){}
      showRefreshReminder('reminder');
      break;
    }
  }
}
function startLocationRefreshReminders(){
  if(locationRefreshTimer) clearInterval(locationRefreshTimer);
  if(locationRefreshChannel) sb.removeChannel(locationRefreshChannel);
  locationRefreshTimer = null;
  locationRefreshChannel = null;
  liveRefreshEvents = [];
  hideRefreshReminder();
  if(isFullAdmin() || isAsistent()) return;
  const previewUrl = new URL(location.href);
  if(previewUrl.searchParams.get('preview-refresh')==='1'){
    previewUrl.searchParams.delete('preview-refresh');
    history.replaceState({},'',`${previewUrl.pathname}${previewUrl.search}${previewUrl.hash}`);
    showRefreshReminder('reminder');
  }
  checkLocationRefreshReminder();
  connectLocationRefreshEvents();
  locationRefreshTimer = setInterval(checkLocationRefreshReminder,30000);
}

async function ensureCurrentAppBuild(){
  if(isFullAdmin() || isAsistent() || location.protocol==='file:') return true;
  const { data, error } = await sb.from('app_config').select('value').eq('key','location_app_build').single();
  if(error || !data?.value){
    showRefreshReminder('verify');
    return false;
  }
  if(data.value!==APP_BUILD){
    showRefreshReminder('update');
    return false;
  }
  return true;
}

function todayISO(){ return new Date().toISOString().slice(0,10); }
function uid(){ return Math.random().toString(36).slice(2,9); }
// calendar math in UTC so the ISO date never shifts with the browser's timezone (Chișinău is UTC+2/+3)
function addDays(iso,n){ const d=new Date(iso+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
function addMonths(iso,n){ const d=new Date(iso+'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth()+n); return d.toISOString().slice(0,10); }
function daysDiff(iso){ const a=new Date(todayISO()+'T00:00:00'); const b=new Date(iso+'T00:00:00'); return Math.round((b-a)/86400000); }
function fmtDate(iso){ if(!iso) return '—'; const [y,m,d]=iso.split('-'); return `${d}.${m}.${y}`; }
function fmtDateTime(value){
  if(!value) return '—';
  const d = new Date(value);
  return `${d.toLocaleDateString(LANG==='ru'?'ru-RU':'ro-RO')} · ${d.toLocaleTimeString(LANG==='ru'?'ru-RU':'ro-RO',{hour:'2-digit',minute:'2-digit'})}`;
}
function fmtTime(value){
  if(!value) return '—';
  return new Date(value).toLocaleTimeString(LANG==='ru'?'ru-RU':'ro-RO', {
    timeZone:'Europe/Chisinau', hour:'2-digit', minute:'2-digit', hour12:false,
  });
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ══════════════════════ DATA LAYER (Supabase) ══════════════════════ */
function adminName(a){ return a ? [a.nume, a.prenume].filter(Boolean).join(' ') : '—'; }
// nume afișat altor administratori — conturile marcate "ascuns" (proprietar, nu angajat) apar generic
function publicAdminName(a){ return !a ? '—' : (a.ascuns ? (LANG==='ru'?'Администратор':'Administrator') : adminName(a)); }
function visibleAdmins(){ return DB.administratori.filter(a=>!a.ascuns); }
// pentru selectoare "asignat lui X" — exclude contul comun de locație, care nu e o persoană reală
function realAdmins(){ return DB.administratori.filter(a=>!a.ascuns && a.rol==='admin'); }

async function fetchAll(){
  const [
    administratoriR, serviciuAdministratoriR, participantiR, arbitriR, intarzieriR, vestimentatieR, serviciuR, spalatorieR,
    hostelR, lenjerieR, dauneR, fairPlayR, arbitrajR, inventarR, sarciniR, observatiiR, pauzeTehniceR, jurnalR, trustedIpsR, treninguriR, sesiuniR, acteSchimbR,
    echipeR, tarifeR, configR, meciuriRows
  ] = await Promise.all([
    sb.from('administratori').select('*'),
    sb.from('serviciu_administratori').select('*').eq('activ', true).order('nume'),
    isAsistent() ? sb.rpc('participanti_asistent') : sb.from('participanti').select('*').order('created_at', {ascending:false}),
    isAsistent() ? sb.rpc('arbitri_asistent') : sb.from('arbitri').select('*').order('created_at', {ascending:false}),
    sb.from('intarzieri').select('*').order('data', {ascending:false}),
    sb.from('vestimentatie').select('*').order('data', {ascending:false}),
    sb.from('serviciu').select('*').order('data', {ascending:false}),
    sb.from('spalatorie').select('*').order('data', {ascending:false}),
    sb.from('hostel').select('*').order('data_cazare', {ascending:false}),
    sb.from('lenjerie').select('*').order('data_eliberare', {ascending:false}),
    sb.from('daune').select('*').order('data', {ascending:false}),
    sb.from('fair_play').select('*').order('data', {ascending:false}),
    sb.from('arbitraj').select('*').order('data', {ascending:false}),
    sb.from('inventar').select('*').order('denumire'),
    sb.from('sarcini').select('*').order('data_inreg', {ascending:false}),
    sb.from('observatii').select('*').order('data', {ascending:false}),
    sb.from('pauze_tehnice').select('*').order('data', {ascending:false}),
    isFullAdmin() ? sb.from('jurnal').select('*').order('data', {ascending:false}).limit(200) : Promise.resolve({data:[]}),
    sb.from('trusted_ips').select('*').order('created_at', {ascending:false}),
    sb.from('treninguri').select('*').order('data', {ascending:false}),
    sb.from('sesiuni_schimb').select('*').eq('cont_id', currentAdminId).is('ended_at', null).order('started_at', {ascending:false}).limit(1),
    sb.from('acte_schimb').select('*').order('created_at', {ascending:false}).limit(60),
    sb.from('echipe').select('*').order('nume'),
    sb.from('tarife_plata').select('*').order('valabil_de_la'),
    sb.from('app_config').select('key,value'),
    selectPaged(()=>sb.from('meciuri').select('*').order('data').order('nr')).catch(e=>{ console.error('meciuri', e); return []; }),
  ]);
  applyAppConfig(configR.data||[]);

  const administratori = administratoriR.data || [];
  const adminById = Object.fromEntries(administratori.map(a=>[a.id, a]));
  const serviciuAdministratori = serviciuAdministratoriR.data || [];
  const serviciuAdminById = Object.fromEntries(serviciuAdministratori.map(a=>[a.id, a]));

  DB = {
    administratori,
    serviciuAdministratori,
    participanti: (participantiR.data||[]).map(mapParticipant),
    echipe: (echipeR.data||[]).map(e=>({ id:e.id, nume:e.nume, culoare:e.culoare, activ:e.activ, logoUrl:e.logo_url, slugExtern:e.slug_extern })),
    tarife: (tarifeR.data||[]).map(mapTarif),
    meciuri: meciuriRows.map(mapMeci),
    arbitri: (arbitriR.data||[]).map(a=>({
      id:a.id, nrDulap:a.nr_dulap, nume:a.nume, prenume:a.prenume, dataNasterii:a.data_nasterii,
      adresa:a.adresa, telefon:a.telefon, email:a.email, dataAvizMedical:a.data_aviz_medical,
      statut:a.statut, dataInregistrarii:a.data_inregistrarii, freelancer: a.freelancer!==false,
      idnp:a.idnp, nrAct:a.nr_act, dataEmiteriiAct:a.data_emiterii_act,
    })),
    intarzieri: (intarzieriR.data||[]).map(r=>({id:r.id, participantId:r.participant_id, arbitru:r.arbitru, data:r.data, minuteIntarziere:r.minute_intarziere, motiv:r.motiv, createdAt:r.created_at})),
    vestimentatie: (vestimentatieR.data||[]).map(r=>({id:r.id, data:r.data, participantId:r.participant_id, arbitru:r.arbitru, inventarId:r.inventar_id, tip:r.tip, culoare:r.culoare, marime:r.marime, cantitate:r.cantitate, dataReturnare:r.data_returnare, stareReturnare:r.stare_returnare})),
    serviciu: (serviciuR.data||[]).map(r=>({
      id:r.id, data:r.data,
      administratorServiciuId:r.administrator_serviciu_id,
      administratorId:r.administrator_id,
      inceputLa:r.inceput_la,
      sfarsitLa:r.sfarsit_la,
      administrator: serviciuAdminById[r.administrator_serviciu_id]?.nume || publicAdminName(adminById[r.administrator_id]),
    })),
    spalatorie: (spalatorieR.data||[]).map(r=>({id:r.id, data:r.data, participantId:r.participant_id, tipArticole:r.tip_articole, cantitate:r.cantitate, suma:Number(r.suma), dataReturnare:r.data_returnare})),
    hostel: (hostelR.data||[]).map(r=>({id:r.id, participantId:r.participant_id, dataCazare:r.data_cazare, observatii:r.observatii, statut:r.statut, createdAt:r.created_at})),
    lenjerie: (lenjerieR.data||[]).map(r=>({id:r.id, participantId:r.participant_id, dataEliberare:r.data_eliberare, dataReturnare:r.data_returnare, sursaStoc:r.sursa_stoc||'nou'})),
    daune: (dauneR.data||[]).map(r=>({
      id:r.id, data:r.data, participantId:r.participant_id, inventarAfectat:r.inventar_afectat, natura:r.natura, teren:r.teren,
      bunDeterioratDistrus:r.stare, observatii:r.observatii, valoareEstimata:Number(r.valoare_estimata||0),
      administratorServiciuAvertizorId:r.administrator_serviciu_avertizor_id, adminAvertizorId:r.admin_avertizor_id,
      avertizor: serviciuAdminById[r.administrator_serviciu_avertizor_id]?.nume || (r.admin_avertizor_id ? publicAdminName(adminById[r.admin_avertizor_id]) : ''),
      nrSursa:r.nr_sursa, createdAt:r.created_at,
    })),
    fairPlay: (fairPlayR.data||[]).map(r=>({id:r.id, participantId:r.participant_id, meciId:r.meci_id, data:r.data, ora:r.ora ? String(r.ora).slice(0,5) : '', platou:r.platou, descriere:r.descriere, tipCartonas:r.tip_cartonas, createdAt:r.created_at})),
    arbitraj: (arbitrajR.data||[]).map(r=>({id:r.id, data:r.data, arbitru:r.arbitru, turneu:r.turneu, cantitateMingi:r.cantitate_mingi, oraStart:r.ora_start?String(r.ora_start).slice(0,5):'', oraStop:r.ora_stop?String(r.ora_stop).slice(0,5):'', observatii:r.observatii, sesiuneSchimbId:r.sesiune_schimb_id, slotSchimb:r.slot_schimb})),
    inventar: (inventarR.data||[]).map(r=>({id:r.id, denumire:r.denumire, culoare:r.culoare, marime:r.marime, um:r.um, cantitateInitiala:r.cantitate_initiala, intrari:r.intrari, iesiri:r.iesiri, cantitateMinima:r.cantitate_minima, stare:r.stare, observatii:r.observatii, conditie:r.conditie})),
    sarcini: (sarciniR.data||[]).map(r=>({id:r.id, dataInreg:r.data_inreg, administratorServiciuInregId:r.administrator_serviciu_inreg_id, adminInreg: serviciuAdminById[r.administrator_serviciu_inreg_id]?.nume || publicAdminName(adminById[r.admin_inreg_id]), status:r.status, actiuni:r.actiuni, dataSolutionare:r.data_solutionare, administratorServiciuSolutionareId:r.administrator_serviciu_solutionare_id, adminSolutionare: serviciuAdminById[r.administrator_serviciu_solutionare_id]?.nume || (r.admin_solutionare_id ? publicAdminName(adminById[r.admin_solutionare_id]) : ''), descriere:r.descriere, createdAt:r.created_at})),
    observatii: (observatiiR.data||[]).map(r=>({id:r.id, data:r.data, participantId:r.participant_id, subiect:r.subiect, categorie:r.categorie, descriere:r.descriere, createdAt:r.created_at})),
    pauzeTehnice: (pauzeTehniceR.data||[]).map(r=>({id:r.id, data:r.data, oraStart:String(r.ora_start||'').slice(0,5), oraStop:String(r.ora_stop||'').slice(0,5), teren:r.teren, descriere:r.descriere, createdAt:r.created_at})),
    jurnal: (jurnalR.data||[]).map(r=>({id:r.id, cont: serviciuAdminById[r.administrator_serviciu_id]?.nume || publicAdminName(adminById[r.administrator_id]), data:String(r.data).slice(0,10), actiune:r.actiune})),
    trustedIps: (trustedIpsR.data||[]).map(r=>({id:r.id, ip:r.ip, eticheta:r.eticheta, createdAt:r.created_at})),
    treninguri: (treninguriR.data||[]).map(r=>({id:r.id, participantId:r.participant_id, antrenor:r.antrenor, data:r.data, ora:r.ora, sumaJucator:Number(r.suma_jucator), sumaAntrenor:Number(r.suma_antrenor), observatii:r.observatii, createdAt:r.created_at})),
    acteSchimb: (acteSchimbR.data||[]).map(r=>({
      id:r.id, data:r.data, numeAdministrator:r.nume_administrator,
      sesiuneSchimbId:r.sesiune_schimb_id, createdAt:r.created_at,
      inceputPerioada:r.inceput_perioada, sfarsitPerioada:r.sfarsit_perioada, continut:r.continut,
    })),
  };
  rosterByMatch.clear(); rosterLoadedDays.clear(); invalidateStats();
  // Older versions could insert more than one snapshot for the same shift. Keep those rows in
  // Supabase for audit purposes, but show only the newest canonical report in the interface.
  const reportShiftIds = new Set();
  DB.acteSchimb = DB.acteSchimb.filter(report=>{
    if(!report.sesiuneSchimbId) return true;
    if(reportShiftIds.has(report.sesiuneSchimbId)) return false;
    reportShiftIds.add(report.sesiuneSchimbId);
    return true;
  });
  if(!isFullAdmin()){
    const open = (sesiuniR.data||[])[0];
    currentShift = open ? {
      id:open.id,
      administratorServiciuId:open.administrator_serviciu_id,
      administrator:serviciuAdminById[open.administrator_serviciu_id]?.nume || '—',
      startedAt:open.started_at,
    } : null;
  }
}

async function refetchInventar(){
  const { data } = await sb.from('inventar').select('*').order('denumire');
  DB.inventar = (data||[]).map(r=>({id:r.id, denumire:r.denumire, culoare:r.culoare, marime:r.marime, um:r.um, cantitateInitiala:r.cantitate_initiala, intrari:r.intrari, iesiri:r.iesiri, cantitateMinima:r.cantitate_minima, stare:r.stare, observatii:r.observatii, conditie:r.conditie}));
}

async function logAction(actiune){
  if(isAsistent()) return;
  const administratorServiciuId = !isFullAdmin() ? currentShift?.administratorServiciuId || null : null;
  DB.jurnal.unshift({ id: uid(), cont: journalActorName(), data: todayISO(), actiune });
  const { error } = await sb.from('jurnal').insert({ administrator_id: currentAdminId, administrator_serviciu_id:administratorServiciuId, actiune });
  if (error) console.error('jurnal insert failed', error);
}

function participant(id){ return DB.participanti.find(p=>p.id===id); }
function participantName(id){ const p=participant(id); return p ? `${p.nume} ${p.prenume}` : '—'; }
function observationTargetName(observation){
  return observation?.participantId ? participantName(observation.participantId) : (observation?.subiect||'—');
}
function arbitru(id){ return DB.arbitri.find(a=>a.id===id); }
function arbitriActivi(){ return DB.arbitri.filter(a=>a.statut==='activ').sort((a,b)=>a.nume.localeCompare(b.nume,'ro')||a.prenume.localeCompare(b.prenume,'ro')); }

/* ══════════════════════ AUTH ══════════════════════ */
function setAuthMode(mode){
  document.getElementById('auth-form-admin').style.display = mode==='admin' ? '' : 'none';
  document.getElementById('auth-form-locatie').style.display = mode==='locatie' ? '' : 'none';
  document.getElementById('auth-mode-admin').classList.toggle('active', mode==='admin');
  document.getElementById('auth-mode-locatie').classList.toggle('active', mode==='locatie');
}
async function login(){
  const email = document.getElementById('l-email').value.trim();
  const password = document.getElementById('l-password').value;
  const msg = document.getElementById('login-msg');
  const btn = document.getElementById('login-btn');
  if(!email || !password){ msg.textContent = t('au_needBoth'); msg.style.color = 'var(--muted)'; return; }
  btn.disabled = true; btn.textContent = t('au_loading');
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = t('au_login');
  if(error){
    msg.textContent = t('au_badCreds');
    msg.style.color = 'var(--red)';
    return;
  }
  const { data: profile } = await sb.from('administratori').select('*').eq('id', data.user.id).maybeSingle();
  // an auth account without a registry profile gets nothing: sign it out instead of guessing a role
  if(!profile){ await sb.auth.signOut(); msg.textContent = t('au_noAccess'); msg.style.color = 'var(--red)'; return; }
  await enterApp(data.user.id, adminName(profile), profile.rol);
}

async function loginLocatie(){
  const pin = document.getElementById('l-pin').value.trim();
  const msg = document.getElementById('login-locatie-msg');
  const btn = document.getElementById('login-locatie-btn');
  msg.innerHTML = ''; msg.style.color = 'var(--muted)';
  if(!pin){ msg.textContent = t('au_pinNeed'); return; }
  btn.disabled = true; btn.textContent = t('au_loading');
  let resp, result;
  try {
    resp = await fetch(`${SUPABASE_URL}/functions/v1/location-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    result = await resp.json();
  } catch(e){
    btn.disabled = false; btn.textContent = t('au_login');
    msg.textContent = t('au_pinServerError');
    msg.style.color = 'var(--red)';
    return;
  }
  btn.disabled = false; btn.textContent = t('au_login');
  if(!resp.ok || result.error){
    msg.style.color = 'var(--red)';
    if(result.error === 'wrong_pin'){ msg.textContent = t('au_pinWrong'); }
    else if(result.error === 'rate_limited'){ msg.textContent = t('au_pinRateLimited'); }
    else if(result.error === 'ip_not_trusted'){
      msg.innerHTML = `${esc(t('au_pinNotTrusted'))}<br>${esc(t('au_pinNotTrustedHint'))}<br><span class="auth-ip-code">${esc(result.ip||'—')}</span>`;
    } else { msg.textContent = t('au_pinServerError'); }
    return;
  }
  const { error: sessErr } = await sb.auth.setSession({ access_token: result.access_token, refresh_token: result.refresh_token });
  if(sessErr){ msg.textContent = t('au_pinServerError'); msg.style.color = 'var(--red)'; return; }
  document.getElementById('l-pin').value = '';
  const { data:{ session } } = await sb.auth.getSession();
  const { data: profile } = await sb.from('administratori').select('*').eq('id', session.user.id).maybeSingle();
  if(!profile){ await sb.auth.signOut(); msg.textContent = t('au_noAccess'); msg.style.color = 'var(--red)'; return; }
  await enterApp(session.user.id, adminName(profile), profile.rol);
}

async function enterApp(userId, displayName, rol){
  currentAdminId = userId;
  currentAdmin = displayName;
  currentRole = rol || 'admin';
  document.body.classList.toggle('role-locatie', currentRole==='locatie');
  document.body.classList.toggle('role-asistent', currentRole==='asistent');
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-shell').classList.add('visible');
  document.getElementById('header-user').textContent = currentAdmin;
  document.getElementById('sb-admin').textContent = currentAdmin;
  await fetchAll();
  await loadSyncMeta().catch(e=>console.error(e));
  document.getElementById('sb-admin').textContent = activeShiftName();
  buildSidebar();
  navigate('dashboard');
  startLocationRefreshReminders();
}

async function logout(){
  await sb.auth.signOut();
  if(locationRefreshTimer) clearInterval(locationRefreshTimer);
  if(locationRefreshChannel) sb.removeChannel(locationRefreshChannel);
  locationRefreshTimer = null;
  locationRefreshChannel = null;
  liveRefreshEvents = [];
  hideRefreshReminder();
  asDash = null; asLog = null;
  currentAdmin = null; currentAdminId = null; currentRole = null; currentShift = null; adminDemoShiftActive = false; shiftStartPrompt = false; DB = null;
  document.body.classList.remove('role-locatie', 'role-asistent');
  document.getElementById('app-shell').classList.remove('visible');
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('login-msg').textContent = '';
  document.getElementById('l-password').value = '';
}

// reia sesiunea dacă administratorul e deja autentificat (session persistă local)
async function resumeSession(){
  const { data:{ session } } = await sb.auth.getSession();
  if(!session) return;
  const { data: profile } = await sb.from('administratori').select('*').eq('id', session.user.id).maybeSingle();
  if(!profile){ await sb.auth.signOut(); return; }
  await enterApp(session.user.id, adminName(profile), profile.rol);
}
/* ══════════════════════ INVITAȚII: înregistrare prin link unic ══════════════════════ */
// Links are always built on the public address, so an admin working on a local copy still hands out a working link.
const PUBLIC_APP_URL = 'https://geezfully.com/bskt-registru/';
// #invitatie=<48 hex>[&lang=ru] — kept in the fragment so the token never reaches a server log or a Referer header
function readInviteToken(){
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const token = h.get('invitatie') || '';
  return /^[0-9a-f]{48}$/.test(token) ? { token, lang: h.get('lang') } : null;
}
async function callInviteFunction(payload){
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/accept-invite`, {
    method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload),
  });
  return resp.json().catch(()=>({ error:'server_error' }));
}
function inviteError(code){
  const key = { invalid:'iv2_errInvalid', used:'iv2_errUsed', expired:'iv2_errExpired', cancelled:'iv2_errCancelled',
    email_exists:'iv2_errEmailExists', bad_email:'iv2_errEmail', bad_password:'iv2_errPassword', bad_name:'iv2_errName' }[code];
  return t(key || 'iv2_errServer');
}
let inviteInfo = null;
async function startInvite(inv){
  if(inv.lang==='ru' || inv.lang==='ro') setLang(inv.lang);
  document.querySelector('.auth-mode-switch').style.display = 'none';
  document.getElementById('auth-form-admin').style.display = 'none';
  document.getElementById('auth-form-locatie').style.display = 'none';
  document.getElementById('auth-form-invite').style.display = '';
  const fields = document.getElementById('inv-fields'), msg = document.getElementById('inv-msg');
  fields.style.display = 'none'; msg.style.color = 'var(--muted)'; msg.textContent = t('iv2_checking');
  let r;
  try { r = await callInviteFunction({ action:'check', token:inv.token }); } catch(e){ r = { error:'server_error' }; }
  if(!r?.ok){ msg.style.color = 'var(--red)'; msg.textContent = inviteError(r?.error); return; }
  inviteInfo = { ...inv, rol:r.rol, expiraLa:r.expira_la };
  renderInviteRole();
  fields.style.display = ''; msg.textContent = '';
  document.getElementById('inv-nume').focus();
}
function renderInviteRole(){
  const el = document.getElementById('inv-role');
  if(!el || !inviteInfo) return;
  el.textContent = t('iv2_role')(t(inviteInfo.rol==='admin' ? 'st_inv_rolAdmin' : 'st_inv_rolAsistent'), fmtDateTime(inviteInfo.expiraLa));
}
async function acceptInvite(){
  if(!inviteInfo) return;
  const nume = document.getElementById('inv-nume').value.replace(/\s+/g,' ').trim();
  const email = document.getElementById('inv-email').value.trim().toLowerCase();
  const password = document.getElementById('inv-pass').value, password2 = document.getElementById('inv-pass2').value;
  const msg = document.getElementById('inv-msg'), btn = document.getElementById('inv-btn');
  msg.style.color = 'var(--red)';
  if(nume.length < 2){ msg.textContent = t('iv2_errName'); return; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){ msg.textContent = t('iv2_errEmail'); return; }
  if(password.length < 8){ msg.textContent = t('iv2_errPassword'); return; }
  if(password !== password2){ msg.textContent = t('iv2_errMismatch'); return; }
  btn.disabled = true; btn.textContent = t('iv2_creating'); msg.textContent = '';
  let r;
  try { r = await callInviteFunction({ action:'accept', token:inviteInfo.token, email, password, nume }); } catch(e){ r = { error:'server_error' }; }
  if(!r?.ok){ btn.disabled = false; btn.textContent = t('iv2_btn'); msg.textContent = inviteError(r?.error); return; }
  // account created: drop the token from the address bar and sign the new user straight in
  history.replaceState(null, '', location.pathname + location.search);
  msg.style.color = 'var(--gold)'; msg.textContent = t('iv2_done');
  await sb.auth.signOut();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if(error){ btn.textContent = t('iv2_btn'); msg.textContent = t('iv2_doneLogin'); return; }
  const { data: profile } = await sb.from('administratori').select('*').eq('id', data.user.id).maybeSingle();
  if(!profile){ await sb.auth.signOut(); msg.style.color = 'var(--red)'; msg.textContent = t('au_noAccess'); return; }
  inviteInfo = null;
  await enterApp(data.user.id, adminName(profile), profile.rol);
}

applyStaticI18n();
setAuthMode('admin');
const ICON_PREVIEW_MODE = new URLSearchParams(location.search).has('icon-preview');
const INVITE = readInviteToken();
if(INVITE) startInvite(INVITE);
else if(!ICON_PREVIEW_MODE) resumeSession();

/* ══════════════════════ ICON SYSTEM ══════════════════════ */
const ICONS = {
  team:'<path d="M8 4 5 5.5 3 9l3 1.5V20h12v-9.5L21 9l-2-3.5L16 4a4 4 0 0 1-8 0Z"/><path d="M10 13h4M12 11v4"/>',
  ball:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18"/><path d="M5.6 5.6c2.8 2.8 2.8 10 0 12.8M18.4 5.6c-2.8 2.8-2.8 10 0 12.8"/>',
  money:'<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
  dashboard:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  participants:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shirt:'<path d="M8 4 4 6l-2 4 4 2v8h12v-8l4-2-2-4-4-2a4.5 4.5 0 0 1-8 0Z"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  washer:'<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M4 7h16M8 4h.01M11 4h.01"/><circle cx="12" cy="14" r="5"/><path d="M9 14c1.5-1.5 4.5 1.5 6 0"/>',
  hostel:'<path d="M3 21V9l9-6 9 6v12M9 21v-7h6v7"/><path d="M3 21h18"/>',
  linen:'<path d="M4 5h16v14H4zM8 5V3h8v2M4 10h16"/><path d="M8 14h8"/>',
  medical:'<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  damage:'<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="m13 8-3 4 3 1-2 4"/>',
  fairplay:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h3"/><circle cx="16" cy="16" r="1.5"/>',
  referee:'<path d="M4 14c3-5 7-7 12-7h5v5h-5c-3 0-5 1-7 4l-5-2Z"/><path d="M9 16v4M6 18h6"/><circle cx="18" cy="9.5" r="1"/>',
  training:'<path d="M6 9v6M3 10v4M18 9v6M21 10v4M6 12h12"/><path d="M2 12h1M21 12h1"/>',
  inventory:'<path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z"/><path d="m3 7.5 9 4.5 9-4.5M3 12l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5"/>',
  tasks:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M8.5 11l2 2 4-4M8 17h8"/>',
  observations:'<path d="M4 4h16v13H8l-4 4V4Z"/><path d="M8 9h8M8 13h5"/>',
  pause:'<circle cx="12" cy="12" r="9"/><path d="M9 8v8M15 8v8"/>',
  reports:'<path d="M6 2h9l4 4v16H6z"/><path d="M14 2v5h5M9 17v-4M12 17V9M15 17v-2"/>',
  settings:'<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="13" cy="18" r="2"/>',
  chart:'<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-7"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  trash:'<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
  edit:'<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  save:'<path d="M5 3h12l3 3v15H4V3h1Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
  close:'<path d="M6 6l12 12M18 6 6 18"/>',
  download:'<path d="M12 3v12M8 11l4 4 4-4M5 20h14"/>',
  print:'<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 8a8 8 0 0 1 13.2-2L20 7M4 17l.7 1A8 8 0 0 0 18 16"/>',
  logout:'<path d="M10 17l5-5-5-5M15 12H3M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/>',
  play:'<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4V8Z"/>',
  stop:'<circle cx="12" cy="12" r="9"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
  key:'<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 4l4 4M14 6l2 2"/>',
  file:'<path d="M6 2h9l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  alert:'<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4M12 17h.01"/>',
  list:'<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>'
};
function icon(name, className='ui-icon'){
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]||ICONS.file}</svg>`;
}
function buttonIconName(button){
  if(button.querySelector('svg')) return null;
  if(button.matches('.toggle-btn,.category-filter-chip,.badge,.lang-btn,.te-swatch,.mcal-step,.mcal-nav,.mcal-cell,.mcal-trigger,.mcal-link,.mcal-foot button')) return null;
  const action=(button.getAttribute('onclick')||'').toLowerCase();
  const label=(button.textContent||'').trim().toLowerCase();
  if(button.matches('.modal-close') || /closemodal|cancel|anulează|отмена/.test(action+' '+label)) return 'close';
  if(/dele|remove|șterge|sterge|удал/.test(action+' '+label)) return 'trash';
  if(/logout|ieșire|выход/.test(action+' '+label)) return 'logout';
  if(/print|imprim|печать/.test(action+' '+label)) return 'print';
  if(/export|\.pdf|excel|download|descar|скач/.test(action+' '+label)) return 'download';
  if(/reload|refresh|reîncar|обнов/.test(action+' '+label)) return 'refresh';
  if(/rotatelocatiepin|pin/.test(action+' '+label)) return 'key';
  if(/stopdashboardshift|oprește|înche|заверш/.test(action+' '+label)) return 'stop';
  if(/openshiftpanel|confirmlocationshift|pornește|start|начать/.test(action+' '+label)) return 'play';
  if(/save|salvează|salveaza|сохран/.test(action+' '+label)) return 'save';
  if(/edit|correct|corect|editează|редакт|измен/.test(action+' '+label)) return 'edit';
  if(/generat|raport|report|отч[её]т/.test(action+' '+label)) return 'file';
  if(/add|adau|înregistr|eliberează|добав|зарегистр|выдать/.test(action+' '+label)) return 'plus';
  if(/toggleSidebar/i.test(button.getAttribute('onclick')||'')) return 'menu';
  return null;
}
function stripLegacyButtonSymbol(button){
  for(const node of button.childNodes){
    if(node.nodeType===Node.TEXT_NODE && node.textContent.trim()){
      node.textContent=node.textContent.replace(/^\s*[+✕☰↻⚠↓⬇⇩⤓]\s*/, '');
      break;
    }
  }
}
function enhanceIcons(root=document){
  root.querySelectorAll('button:not([data-iconized])').forEach(button=>{
    const name=buttonIconName(button);
    button.dataset.iconized='true';
    if(!name) return;
    stripLegacyButtonSymbol(button);
    if(button.matches('.modal-close')) button.textContent='';
    button.insertAdjacentHTML('afterbegin',icon(name));
    button.classList.add('has-ui-icon');
  });
  const title=root.querySelector('.view-title:not([data-iconized])');
  if(title && currentView){
    title.dataset.iconized='true';
    title.insertAdjacentHTML('afterbegin',`<span class="view-title-icon">${icon(NAV.find(n=>n.id===currentView)?.icon||'file')}</span>`);
  }
  root.querySelectorAll('.form-title:not([data-iconized]),.table-title:not([data-iconized]),.alerts-panel-head:not([data-iconized])').forEach(el=>{
    el.dataset.iconized='true';
    for(const node of el.childNodes){
      if(node.nodeType===Node.TEXT_NODE && node.textContent.trim()){
        node.textContent=node.textContent.replace(/^\s*⚠\s*/, '');
        break;
      }
    }
    const name=el.matches('.form-title')?'plus':el.matches('.alerts-panel-head')?'bell':'list';
    el.insertAdjacentHTML('afterbegin',icon(name,'ui-icon section-icon'));
  });
}

/* ══════════════════════ NAV ══════════════════════ */
const NAV = [
  {id:'dashboard', key:'nav_dashboard', icon:'dashboard'},
  {id:'participanti', key:'nav_participanti', icon:'participants'},
  {id:'echipe', key:'nav_echipe', icon:'team'},
  {id:'meciuri', key:'nav_meciuri', icon:'ball'},
  {id:'plati', key:'nav_plati', icon:'money'},
  {id:'statistici', key:'nav_statistici', icon:'chart'},
  {id:'serviciu', key:'nav_serviciu', icon:'calendar'},
  {id:'spalatorie', key:'nav_spalatorie', icon:'washer'},
  {id:'hostel', key:'nav_hostel', icon:'hostel'},
  {id:'lenjerie', key:'nav_lenjerie', icon:'linen'},
  {id:'medical', key:'nav_medical', icon:'medical'},
  {id:'daune', key:'nav_daune', icon:'damage'},
  {id:'arbitraj', key:'nav_arbitraj', icon:'referee'},
  {id:'inventar', key:'nav_inventar', icon:'inventory'},
  {id:'sarcini', key:'nav_sarcini', icon:'tasks'},
  {id:'observatii', key:'nav_observatii', icon:'observations'},
  {id:'pauzatehnica', key:'nav_pauzatehnica', icon:'pause'},
  {id:'rapoarte', key:'nav_rapoarte', icon:'reports'},
  {id:'setari', key:'nav_setari', icon:'settings'},
];
const LOCATION_HIDDEN_VIEWS = new Set(['setari','plati']);
// everything a helper account can open (all read-only)
const ASISTENT_VIEWS = new Set(['dashboard','participanti','echipe','meciuri','plati','statistici','serviciu','spalatorie','hostel','lenjerie','medical','daune','arbitraj','inventar','sarcini','observatii','pauzatehnica']);
// read-only views a location account can open before starting a shift
const NO_SHIFT_VIEWS = new Set(['dashboard','rapoarte','statistici','meciuri','echipe']);

function buildSidebar(){
  const nav = document.getElementById('sb-nav');
  const footLabel = document.querySelector('.sb-foot span');
  if(footLabel) footLabel.textContent = isAsistent() ? t('as_cont') : t('sb_shift');
  nav.innerHTML = NAV.filter(item => {
    if(isFullAdmin()) return true;
    if(isAsistent()) return ASISTENT_VIEWS.has(item.id);
    if(!currentShift) return NO_SHIFT_VIEWS.has(item.id);
    return !LOCATION_HIDDEN_VIEWS.has(item.id);
  }).map(item => {
    const badge = navBadge(item.id);
    return `<button class="sb-item" data-view="${item.id}" onclick="navigate('${item.id}')">
      <span class="sb-icon">${icon(item.icon)}</span><span>${esc(t(item.key))}</span>
      ${badge ? `<span class="sb-badge">${badge}</span>` : ''}
    </button>`;
  }).join('');
}
function navBadge(id){
  if(!DB) return 0;
  if(id==='medical') return medicalAlerts().length || '';
  if(id==='sarcini') return DB.sarcini.filter(s=>s.status!=='soluționat').length || '';
  if(id==='inventar') return lowStockItems().length || '';
  return '';
}

function navigate(view){
  if(!NAV.some(n=>n.id===view)) view = 'dashboard';
  if(view==='dashboard' && !asDash?.loading) asDash = null;
  if(view==='dashboard' && !asLog?.loading) asLog = null;   // helper dashboard: fresh problem list on every visit
  if(isAsistent()){ if(!ASISTENT_VIEWS.has(view)) view = 'dashboard'; }
  else {
    if(!isFullAdmin() && LOCATION_HIDDEN_VIEWS.has(view)) view = 'dashboard';
    if(!isFullAdmin() && !currentShift && !NO_SHIFT_VIEWS.has(view)) view = 'dashboard';
  }
  currentView = view;
  document.querySelectorAll('.sb-item').forEach(el => el.classList.toggle('active', el.dataset.view===view));
  const navItem = NAV.find(n=>n.id===view);
  document.getElementById('header-title').textContent = navItem ? t(navItem.key) : '';
  toggleSidebar(false);
  render();
  if(view==='statistici') openStatistici();
  if(view==='meciuri') openMeciuri();
  if(view==='plati') openPlati();
  if(view==='echipe') openEchipe();
}
function toggleSidebar(force){
  const sb = document.getElementById('sidebar'), scrim = document.getElementById('sb-scrim');
  const open = force===undefined ? !sb.classList.contains('open') : force;
  sb.classList.toggle('open', open); scrim.classList.toggle('visible', open);
}

/* ══════════════════════ DERIVED / ALERTS ══════════════════════ */
function medicalRows(){
  return DB.participanti.filter(p=>p.statut==='activ').map(p=>{
    if(!p.dataAvizMedical){
      return { participantId:p.id, nume:participantName(p.id), dataAviz:null, dataExpirare:null, zile:null, status:'fără aviz' };
    }
    const expira = addMonths(p.dataAvizMedical, 6);
    const zile = daysDiff(expira);
    let status = 'valabil';
    if(zile < 0) status = 'expirat'; else if(zile <= 30) status = 'expiră curând';
    return { participantId:p.id, nume:participantName(p.id), dataAviz:p.dataAvizMedical, dataExpirare:expira, zile, status };
  }).sort((a,b)=>{
    if(a.status==='fără aviz' || b.status==='fără aviz'){
      if(a.status===b.status) return a.nume.localeCompare(b.nume, LANG==='ru'?'ru':'ro');
      return a.status==='fără aviz' ? 1 : -1;
    }
    return a.zile-b.zile;
  });
}
function medicalAlerts(){ return medicalRows().filter(r=>r.status!=='fără aviz' && r.zile<=7); }
function lowStockItems(){ return DB.inventar.filter(i=> (i.cantitateInitiala+i.intrari-i.iesiri) < i.cantitateMinima); }
function staleTasks(){ return DB.sarcini.filter(s=>s.status!=='soluționat' && daysDiff(s.dataInreg) <= -2); }
function frequentLate(){
  const counts = {};
  DB.intarzieri.forEach(i=>{ if(daysDiff(i.data) >= -30){ const key=i.arbitru?`referee:${i.arbitru}`:`participant:${i.participantId}`; counts[key]=(counts[key]||0)+1; } });
  return Object.entries(counts).filter(([,c])=>c>=3).map(([key,c])=>key.startsWith('referee:')
    ? {participantId:null, arbitru:key.slice(8), count:c}
    : {participantId:key.slice(12), arbitru:null, count:c});
}
function inventoryCurrent(item){ return item.cantitateInitiala + item.intrari - item.iesiri; }
function inventoryStare(curent, minima){
  if(curent <= 0) return 'zero';
  if(curent < minima) return 'sub minim';
  if(curent === minima) return 'minim';
  return 'bună';
}
const INVENTAR_TOP_ORDER = { 'Mingi baschet 3×3':0, 'Seturi lenjerie':1 };
const INVENTAR_SIZE_ORDER = ['S','M','L','XL','XXL','XXXL'];
function inventarHasVariant(i){ return i.culoare && i.culoare!=='—' && i.marime && i.marime!=='—'; }
function inventarSorted(list){
  return (list || DB.inventar).slice().sort((a,b)=>{
    const va = inventarHasVariant(a) ? 1 : 0, vb = inventarHasVariant(b) ? 1 : 0;
    if(va !== vb) return va - vb;
    if(a.denumire !== b.denumire) return va === 0
      ? (INVENTAR_TOP_ORDER[a.denumire] ?? 99) - (INVENTAR_TOP_ORDER[b.denumire] ?? 99)
      : a.denumire.localeCompare(b.denumire);
    return INVENTAR_SIZE_ORDER.indexOf(a.marime) - INVENTAR_SIZE_ORDER.indexOf(b.marime);
  });
}

function buildAlerts(){
  const alerts = [];
  medicalAlerts().forEach(r=>{
    alerts.push({ type:'medical', level: r.zile<0?'red':'yellow', text: r.zile<0
      ? t('al_medExpired')(r.nume)
      : t('al_medSoon')(r.nume, r.zile) });
  });
  lowStockItems().forEach(i=>{
    alerts.push({ type:'inventory', level:'yellow', text: t('al_lowStock')(`${trEnum(i.denumire)}${i.marime!=='—'?' '+i.marime:''}`, inventoryCurrent(i), i.um, i.cantitateMinima) });
  });
  DB.sarcini.filter(s=>s.status!=='soluționat').forEach(t2=>{
    const isStale = daysDiff(t2.dataInreg) <= -2;
    alerts.push({ type:'task', level:isStale?'red':'yellow', text: isStale
      ? t('al_staleTask')(t2.descriere)
      : t('al_openTask')(t2.descriere) });
  });
  if(isFullAdmin() && tabelPending) alerts.unshift({ type:'sync', level:'yellow', text: t('al_tabelNume')(tabelPending) });
  return alerts;
}

/* ══════════════════════ RENDER DISPATCH ══════════════════════ */
function render(){
  buildSidebar();
  document.querySelectorAll('.sb-item').forEach(el => el.classList.toggle('active', el.dataset.view===currentView));
  const main = document.getElementById('main');
  const fns = {
    dashboard: renderDashboard, participanti: renderParticipanti, intarzieri: renderIntarzieri,
    vestimentatie: renderVestimentatie, serviciu: renderServiciu, spalatorie: renderSpalatorie,
    hostel: renderHostel, lenjerie: renderLenjerie, medical: renderMedical, daune: renderDaune, fairplay: renderFairPlay,
    arbitraj: renderArbitraj, antrenamente: renderAntrenamente, inventar: renderInventar, sarcini: renderSarcini, observatii: renderObservatii,
    pauzatehnica: renderPauzaTehnica, statistici: renderStatistici,
    echipe: renderEchipe, meciuri: renderMeciuri, plati: renderPlati,
    rapoarte: renderRapoarte, setari: renderSetari,
  };
  main.classList.toggle('wide', ['plati','statistici','participanti'].includes(currentView));
  main.innerHTML = fns[currentView] ? fns[currentView]() : '';
  if(currentView==='plati') fitPayDetails();
  enhanceIcons(main);
  labelTables(main);
  foldEntryForms(main);
}
function participantAcOptions(extra){
  const base = DB.participanti.filter(p=>p.statut==='activ').map(p=>({value:p.id, label:`${p.nume} ${p.prenume}`}));
  return extra ? [...extra, ...base] : base;
}
function participantAndRefereeAcOptions(){
  const participants = DB.participanti.filter(p=>p.statut==='activ').map(p=>({value:'participant:'+p.id, label:`${p.nume} ${p.prenume}`}));
  const referees = arbitriActivi().map(a=>({value:'referee:'+a.nume+' '+a.prenume, label:`${a.nume} ${a.prenume} · Arbitru`}));
  return [...participants, ...referees];
}
function selectedPerson(value){
  if(value.startsWith('referee:')) return { participantId:null, arbitru:value.slice(8) };
  return { participantId:value.replace(/^participant:/, ''), arbitru:null };
}
/* searchable autocomplete: keeps a hidden input with id `id` (same .value contract as the <select> it replaces) */
const acData = {};
function autocompleteField(id, options, opts){
  opts = opts || {};
  acData[id] = { options, filtered: options, onSelect: opts.onSelect || null };
  const selectedValue = opts.selectedValue !== undefined ? opts.selectedValue : '';
  const sel = options.find(o=>o.value===selectedValue);
  return `<div class="ac-wrap">
    <input type="text" id="${id}-q" autocomplete="off" placeholder="${esc(opts.placeholder || t('ac_participantPh'))}" value="${esc(sel?sel.label:'')}" oninput="acFilter('${id}')" onfocus="acFocus('${id}')" onblur="acBlur('${id}')" onkeydown="acKey(event,'${id}')">
    <input type="hidden" id="${id}" value="${esc(selectedValue)}">
    <div class="ac-list" id="${id}-list" style="display:none"></div>
  </div>`;
}
// search ignores case and diacritics: "raducan" finds "Răducan", "tibrigan" finds "Țîbrigan"/"Ţîbrigan"
function searchNorm(v){ return String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
// Focusing selects the shown text (e.g. "Locația (fără participant)") so typing replaces it,
// and the list starts complete instead of being filtered by the current selection's label.
function acFocus(id){
  const q = document.getElementById(id+'-q');
  q.select();
  acFilter(id, true);
}
function acFilter(id, showAll){
  const input = document.getElementById(id+'-q');
  const all = acData[id]?.options || [];
  const selected = all.find(o=>o.value===document.getElementById(id).value);
  const q = (showAll || (selected && input.value===selected.label)) ? '' : searchNorm(input.value);
  const items = q ? all.filter(o=>searchNorm(o.label).includes(q)) : all;
  acData[id].filtered = items;
  const list = document.getElementById(id+'-list');
  list.innerHTML = items.length ? items.slice(0,300).map((o,i)=>`<div class="ac-item" onmousedown="acSelect('${id}',${i})">${esc(o.label)}</div>`).join('') : `<div class="ac-item ac-empty">${esc(t('ac_noResults'))}</div>`;
  list.style.display = 'block';
}
function acSelect(id, idx){
  const o = acData[id]?.filtered?.[idx];
  if(!o) return;
  document.getElementById(id).value = o.value;
  document.getElementById(id+'-q').value = o.label;
  document.getElementById(id+'-list').style.display = 'none';
  if(acData[id].onSelect) window[acData[id].onSelect]();
}
function acKey(e, id){
  if(e.key==='Escape'){ document.getElementById(id+'-list').style.display='none'; e.target.blur(); }
  if(e.key==='Enter'){ e.preventDefault(); const filtered = acData[id]?.filtered; if(filtered?.length===1) acSelect(id,0); }
}
function acBlur(id){
  setTimeout(()=>{
    const list = document.getElementById(id+'-list');
    if(list) list.style.display = 'none';
    const hidden = document.getElementById(id), q = document.getElementById(id+'-q');
    if(!hidden || !q) return;
    const opt = (acData[id]?.options||[]).find(o=>o.value===hidden.value);
    q.value = opt ? opt.label : '';
  }, 150);
}
function entryPersonName(row){ return row.arbitru || participantName(row.participantId); }
function disabledAttr(adminOnly){
  if(adminOnly) return !isFullAdmin() ? 'disabled' : '';
  return !hasActiveShift() ? 'disabled' : '';
}

/* ══════════════════════ DASHBOARD ══════════════════════ */
function serviceEmployeeOptions(selectedId){
  return DB.serviciuAdministratori.map(a=>`<option value="${a.id}" ${a.id===selectedId?'selected':''}>${esc(a.nume)}</option>`).join('');
}
function dashboardArbitrajRows(){
  if(isFullAdmin()) return DB.arbitraj.filter(a=>demoShiftArbitrajIds.includes(a.id));
  return currentShift ? DB.arbitraj.filter(a=>a.sesiuneSchimbId===currentShift.id) : [];
}
function dashboardRefereeOptions(selectedName){
  const names = arbitriActivi().map(a=>`${a.nume} ${a.prenume}`);
  if(selectedName && !names.includes(selectedName)) names.unshift(selectedName);
  return names.map(name=>`<option value="${esc(name)}" ${name===selectedName?'selected':''}>${esc(name)}</option>`).join('');
}
function dashboardVenueOptions(selectedVenue){
  const venues = TERENURI.includes(selectedVenue) ? TERENURI : [selectedVenue, ...TERENURI].filter(Boolean);
  return venues.map(venue=>`<option value="${esc(venue)}" ${venue===selectedVenue?'selected':''}>${esc(venue)}</option>`).join('');
}
function canCorrectDashboardReferee(row){
  if(!row) return false;
  if(isFullAdmin()) return adminDemoShiftActive && demoShiftArbitrajIds.includes(row.id);
  return !!currentShift && row.sesiuneSchimbId===currentShift.id;
}
function openShiftPanel(){
  if(isFullAdmin()){
    adminDemoShiftActive = true;
    demoShiftArbitrajIds = [];
    dashboardRefereeEditId = null;
    dashboardTrainingRows = 1;
    render();
    return;
  }
  shiftStartPrompt = true;
  render();
}
async function confirmLocationShift(){
  const employeeId = document.getElementById('shift-employee')?.value;
  const employee = DB.serviciuAdministratori.find(a=>a.id===employeeId);
  if(!employee){ alert(t('sh_faraPersonal')); return; }
  const { data, error } = await sb.from('sesiuni_schimb').insert({
    cont_id:currentAdminId,
    administrator_serviciu_id:employeeId,
  }).select().single();
  if(error){ alert(t('sh_startError')+' '+error.message); return; }
  currentShift = { id:data.id, administratorServiciuId:employeeId, administrator:employee.nume, startedAt:data.started_at };
  shiftStartPrompt = false;
  dashboardRefereeEditId = null;
  dashboardTrainingRows = 1;
  document.getElementById('sb-admin').textContent = employee.nume;
  await logAction(`A început schimbul de locație: ${employee.nume}`);
  buildSidebar();
  render();
  checkLocationRefreshReminder();
}
/* ══════════════════════ RAPORT DE SCHIMB ══════════════════════ */
/* Core builder shared by the live "generate for current shift" button and the admin
   "generate for a past shift" picker — always scoped by the shift's actual entry/exit window
   (sesiuni_schimb.started_at → ended_at, or → now for a still-open shift), never by calendar
   date, since these are night shifts and a date filter would wrongly split one shift's data
   across two days. */
function cleanActReason(value){
  return String(value||'').replace(/\s*#[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/ig, '').trim();
}
// The stock triggers only record "Eliberare vestimentație #<id>" (or a lenjerie equivalent), so
// resolve that id to the person who received or returned the item before the id is stripped.
function actMovementReason(value){
  const motiv = String(value||'');
  const m = motiv.match(/^(Eliberare vestimentație|Returnare vestimentație|Anulare returnare vestimentație|Set lenjerie eliberat|Returnare set lenjerie) #([0-9a-f-]{36})\b/i);
  if(!m) return cleanActReason(motiv);
  const [, actiune, id] = m;
  const row = actiune.includes('lenjerie')
    ? DB.lenjerie.find(r=>r.id===id)
    : DB.vestimentatie.find(r=>r.id===id);
  if(!row) return cleanActReason(motiv);
  const nume = entryPersonName(row);
  const legatura = /^(Eliberare vestimentație|Set lenjerie eliberat)$/i.test(actiune) ? 'către'
    : /^Returnare/i.test(actiune) ? 'de la' : '—';
  return nume ? `${actiune} ${legatura} ${nume}` : actiune;
}
// Saved acts keep the Romanian stock-movement reason; the Russian export translates the known
// templates at render time (names and platou labels stay as written). Unknown text passes through.
const ACT_REASON_RU = [
  [/^Eliberare vestimentație(?: către (.+))?$/i, (m,n)=>n ? `Выдача формы: ${n}` : 'Выдача формы'],
  [/^Returnare vestimentație(?: de la (.+))?$/i, (m,n)=>n ? `Возврат формы: ${n}` : 'Возврат формы'],
  [/^Anulare returnare vestimentație(?: — (.+))?$/i, (m,n)=>n ? `Отмена возврата формы: ${n}` : 'Отмена возврата формы'],
  [/^Set lenjerie eliberat(?: către (.+))?$/i, (m,n)=>n ? `Выдача комплекта белья: ${n}` : 'Выдача комплекта белья'],
  [/^Returnare set lenjerie(?: de la (.+))?$/i, (m,n)=>n ? `Возврат комплекта белья: ${n}` : 'Возврат комплекта белья'],
  // the stock trigger writes "Mingi eliberate arbitrului <nume> (<teren>)" (no brand word)
  [/^Mingi eliberate arbitrului (.+?)(?: \((.+)\))?$/i, (m,n,ter)=>`Мячи выданы арбитру ${n}${ter ? ` (${ter})` : ''}`],
  [/^Mingi (\S+) eliberate arbitrului (.+)$/i, (m,marca,n)=>`Мячи ${marca} выданы арбитру ${n}`],
  [/^Ștergere arbitraj (.+?) \((.+)\): mingi restituite$/i, (m,n,ter)=>`Запись судейства удалена: ${n} (${ter}), мячи возвращены`],
  [/^Corecție vestimentație: anulare eliberare$/i, ()=>'Исправление выдачи формы: выдача отменена'],
  [/^Corecție vestimentație: eliberare corectată$/i, ()=>'Исправление выдачи формы: выдача исправлена'],
  [/^Corecție set lenjerie: anulare eliberare$/i, ()=>'Исправление комплекта белья: выдача отменена'],
  [/^Corecție set lenjerie: anulare returnare$/i, ()=>'Исправление комплекта белья: возврат отменён'],
  [/^Corecție set lenjerie: eliberat din (nou|uzat)$/i, (m,src)=>`Исправление комплекта белья: выдан из ${src==='uzat'?'б/у':'новых'}`],
  [/^Corecție set lenjerie: returnare$/i, ()=>'Исправление комплекта белья: возврат'],
  [/^Corecție mingi arbitraj pentru (.+): anulare valoare anterioară$/i, (m,n)=>`Корректировка мячей для арбитра ${n}: отмена прежнего значения`],
  [/^Ajustare manuală din pagina Inventar$/i, ()=>'Ручная корректировка на странице Инвентарь'],
  [/^Intrare înregistrată din tabloul de bord$/i, ()=>'Поступление, внесённое с панели управления'],
];
function actReasonText(value, lang=LANG){
  const motiv = cleanActReason(value);
  if(lang!=='ru') return motiv;
  for(const [re, fn] of ACT_REASON_RU){
    const m = motiv.match(re);
    if(m) return fn(...m);
  }
  return motiv;
}

function actRoomNumber(value){
  const raw = String(value||'').trim();
  if(!raw) return '';
  return raw.replace(/^(?:camer(?:a|ă)|комната|komnata)\s*(?:nr\.?|№|#)?\s*/iu,'').trim();
}

function trainingStatusAt(row, cutoffIso){
  const cutoffLocal = new Intl.DateTimeFormat('sv-SE', {
    timeZone:'Europe/Chisinau', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23',
  }).format(new Date(cutoffIso)).replace(' ', 'T');
  return `${row.data}T${String(row.ora||'23:59').slice(0,5)}` > cutoffLocal ? 'programat' : 'desfășurat';
}

async function buildActContinut(startedAt, endedAt, shiftId){
  const rowsInWindow = table => sb.from(table).select('*').gte('created_at', startedAt).lte('created_at', endedAt).order('created_at');
  const arbitrajQuery = shiftId
    ? sb.from('arbitraj').select('*').eq('sesiune_schimb_id', shiftId).order('slot_schimb')
    : rowsInWindow('arbitraj');
  const meciuriQuery = shiftId
    ? sb.from('meciuri').select('*').eq('sesiune_schimb_id', shiftId).order('nr')
    : sb.from('meciuri').select('*').gte('data', startedAt.slice(0,10)).lte('data', endedAt.slice(0,10)).order('nr');
  const [intarzieriR, arbitrajR, fairPlayR, dauneR, miscariR, hostelR, treninguriR, sarciniR, sarciniSolutionateR, observatiiR, pauzeTehniceR, meciuriR] = await Promise.all([
    rowsInWindow('intarzieri'),
    arbitrajQuery,
    rowsInWindow('fair_play'),
    rowsInWindow('daune'),
    rowsInWindow('inventar_miscari'),
    rowsInWindow('hostel'),
    rowsInWindow('treninguri'),
    sb.from('sarcini').select('*').order('created_at'),
    sb.from('sarcini_istoric_status').select('sarcina_id,schimbat_la')
      .eq('status_nou','soluționat')
      .gte('schimbat_la',startedAt)
      .lte('schimbat_la',endedAt),
    rowsInWindow('observatii'),
    rowsInWindow('pauze_tehnice'),
    meciuriQuery,
  ]);
  const failed = [intarzieriR, arbitrajR, fairPlayR, dauneR, miscariR, hostelR, treninguriR, sarciniR, sarciniSolutionateR, observatiiR, pauzeTehniceR, meciuriR].find(result=>result.error);
  if(failed) throw failed.error;
  const inventarById = Object.fromEntries(DB.inventar.map(i=>[i.id,i]));
  const sarciniSolutionateInSchimb = new Set((sarciniSolutionateR.data||[]).map(row=>row.sarcina_id));

  return {
    admin: { data: startedAt.slice(0,10), nume: '' },
    meciuri: (meciuriR.data||[]).map(r=>({ nr: r.nr, ora: r.ora ? matchTimeLabel(r.data, r.ora) : '', a: echipaName(r.echipa_a_id), b: echipaName(r.echipa_b_id),
      scor: r.scor_a==null || r.scor_b==null ? '' : `${r.scor_a}:${r.scor_b}` })),
    intarzieri: (intarzieriR.data||[]).map(r=>({ nume: entryPersonName({participantId:r.participant_id, arbitru:r.arbitru}), min: r.minute_intarziere, motiv: r.motiv || '' })),
    arbitraj: (arbitrajR.data||[]).map(r=>({ platou: r.turneu, arbitru: r.arbitru })),
    fairPlay: (fairPlayR.data||[]).map(r=>({ nume: participantName(r.participant_id), ora: r.ora ? String(r.ora).slice(0,5) : '', cartonas: r.tip_cartonas, descriere: r.descriere || '' })),
    daune: (dauneR.data||[]).map(r=>({ nume: participantName(r.participant_id), platou: r.teren || '', descriere: `${r.inventar_afectat} — ${r.natura}` })),
    // Keep every real stock entry and exit recorded during the shift. Administrative
    // corrections only repair a counter and must not be presented as physical movement.
    inventar: (miscariR.data||[]).filter(r=>!(r.motiv||'').startsWith('Corecție manuală din pagina Inventar')).map(r=>{
      const item = inventarById[r.inventar_id];
      // Stocul nou și cel uzat sunt articole separate cu aceeași denumire și mărime
      // (ex. inv-r-l / inv-r-l-uzat), deci fără condiție rândurile ar fi identice în raport.
      // Pentru un articol lipsă din inventar condiția rămâne necunoscută, nu presupusă „nou”.
      return {
        tip: r.tip,
        articol: item ? `${item.denumire}${item.marime && item.marime!=='—' ? ' — '+item.marime : ''}` : r.inventar_id,
        conditie: item ? (item.conditie==='uzat' ? 'uzat' : 'nou') : null,
        cantitate: r.cantitate,
        motiv: actMovementReason(r.motiv),
      };
    }),
    hostel: (hostelR.data||[]).map(r=>({ nume: participantName(r.participant_id), camera: r.observatii || '', ora: fmtTime(r.created_at), statut: r.statut })),
    treninguri: (treninguriR.data||[]).map(r=>({ nume: participantName(r.participant_id), antrenor: r.antrenor, data: r.data, ora: r.ora ? String(r.ora).slice(0,5) : '', statut: trainingStatusAt(r, endedAt) })),
    // Carry every unfinished task into the handover report, even if it was created during an
    // earlier shift. Completed tasks belong only to the shift in which the exact transition to
    // "soluționat" happened; the Set also prevents duplicates if a task changed status twice.
    sarcini: (sarciniR.data||[])
      .filter(r=>r.status==='nesoluționat' || r.status==='în lucru' || (r.status==='soluționat' && sarciniSolutionateInSchimb.has(r.id)))
      .map(r=>({ statut: r.status, descriere: r.descriere || '' })),
    observatii: (observatiiR.data||[]).map(r=>({ nume: observationTargetName({participantId:r.participant_id, subiect:r.subiect}), categorie: r.categorie || '', descriere: r.descriere || '' })),
    pauzeTehnice: (pauzeTehniceR.data||[]).map(r=>{
      const oraStart = String(r.ora_start||'').slice(0,5), oraStop = String(r.ora_stop||'').slice(0,5);
      return { teren: r.teren || '', oraStart, oraStop, durata: pauzaDurata(oraStart, oraStop), descriere: r.descriere || '' };
    }),
  };
}
async function saveActSchimb({ shiftId, administratorServiciuId, administratorId, numeAdministrator, startedAt, endedAt }){
  // Refresh lookup data before assembling the snapshot, then read every report section directly
  // from Supabase. This includes rows added in the same open browser tab and on another device.
  await fetchAll();
  const continut = await buildActContinut(startedAt, endedAt, shiftId);
  continut.admin.nume = numeAdministrator;
  const row = {
    sesiune_schimb_id: shiftId,
    administrator_serviciu_id: administratorServiciuId,
    administrator_id: administratorId,
    data: startedAt.slice(0,10),
    inceput_perioada: startedAt,
    sfarsit_perioada: endedAt,
    nume_administrator: numeAdministrator,
    continut,
  };
  let data, error;
  if(shiftId){
    const existingResult = await sb.from('acte_schimb').select('id').eq('sesiune_schimb_id',shiftId).order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(existingResult.error) throw existingResult.error;
    const result = existingResult.data
      ? await sb.from('acte_schimb').update(row).eq('id',existingResult.data.id).select().single()
      : await sb.from('acte_schimb').insert(row).select().single();
    data = result.data;
    error = result.error;
  }else{
    const result = await sb.from('acte_schimb').insert(row).select().single();
    data = result.data;
    error = result.error;
  }
  if(error) throw error;
  const act = { id:data.id, data:data.data, numeAdministrator:data.nume_administrator, sesiuneSchimbId:data.sesiune_schimb_id, createdAt:data.created_at, inceputPerioada:data.inceput_perioada, sfarsitPerioada:data.sfarsit_perioada, continut:data.continut };
  const existingIndex = DB.acteSchimb.findIndex(item=>item.id===act.id);
  if(existingIndex>=0) DB.acteSchimb.splice(existingIndex,1,act);
  else DB.acteSchimb.unshift(act);
  return act;
}
async function generateActSchimb(){
  if(!(await ensureCurrentAppBuild())) return;
  const active = isFullAdmin() ? adminDemoShiftActive : !!currentShift;
  if(!active){ alert(t('act_needShift')); return; }
  const startedAt = isFullAdmin() ? new Date(Date.now() - 8*3600*1000).toISOString() : currentShift.startedAt;
  const now = new Date().toISOString();
  const shiftId = isFullAdmin() ? null : currentShift.id;
  const administratorServiciuId = isFullAdmin() ? null : currentShift.administratorServiciuId;
  const numeAdministrator = activeShiftName();
  const btn = document.getElementById('act-generate-btn');
  if(btn){ btn.disabled = true; btn.textContent = t('act_generating'); }
  try{
    const act = await saveActSchimb({ shiftId, administratorServiciuId, administratorId: isFullAdmin() ? currentAdminId : null, numeAdministrator, startedAt, endedAt: now });
    await logAction(`A generat raportul de schimb pentru ${numeAdministrator}`);
    openActPreview(act);
  } catch(error){
    alert('Generarea actului a eșuat: ' + error.message);
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = t('act_btnGenerate'); }
  }
}
let currentActPreview = null;
let actExportLanguage = 'ro';
function openActPreview(act){
  if(!act) return;
  currentActPreview = act;
  actExportLanguage = LANG === 'ru' ? 'ru' : 'ro';
  const langSelect = document.getElementById('act-export-lang');
  if(langSelect) langSelect.value = actExportLanguage;
  document.getElementById('act-modal-body').innerHTML = renderActDoc(act, actExportLanguage);
  openModal('act-modal');
}
function setActExportLanguage(lang){
  actExportLanguage = lang === 'ru' ? 'ru' : 'ro';
  if(currentActPreview) document.getElementById('act-modal-body').innerHTML = renderActDoc(currentActPreview, actExportLanguage);
}
function printActReport(){
  if(currentActPreview) document.getElementById('act-modal-body').innerHTML = renderActDoc(currentActPreview, actExportLanguage);
  window.print();
}
function openActPreviewById(id){
  openActPreview(DB.acteSchimb.find(x=>x.id===id));
}
/* Section definitions shared by the on-screen preview and both exports, so all three always agree. */
// Rapoartele salvate înainte de adăugarea condiției nu o conțin — se afișează „—”, nu „nou”.
function actConditieLabel(conditie, lang=LANG){
  if(conditie!=='nou' && conditie!=='uzat') return '';
  return t(conditie==='uzat' ? 'le_stockUsed' : 'le_stockNew', lang);
}
const ACT_SECTIONS_REMOVED = new Set(['act_s_intarzieri','act_s_fairplay','act_s_treninguri']);
function actSections(c, lang=LANG){
  return actSectionsAll(c, lang).filter(s=>!ACT_SECTIONS_REMOVED.has(s.titleKey));
}
function actSectionsAll(c, lang=LANG){
  return [
    ...(c.meciuri ? [{ titleKey:'act_s_meciuri', headers:['#', t('act_ora',lang), t('act_echipaA',lang), t('act_scor',lang), t('act_echipaB',lang)], rows:c.meciuri.map(r=>[r.nr??'', r.ora||'', r.a, r.scor, r.b]) }] : []),
    { titleKey:'act_s_intarzieri', headers:[t('act_numeSportiv',lang), t('act_min',lang), t('act_motiv',lang)], rows:(c.intarzieri||[]).map(r=>[r.nume, r.min ?? '', r.motiv||'']) },
    { titleKey:'act_s_arbitraj', headers:[t('act_platou',lang), t('act_numeArbitru',lang)], rows:(c.arbitraj||[]).map(r=>[r.platou, r.arbitru]) },
    { titleKey:'act_s_fairplay', headers:[t('act_numeSportiv',lang), t('act_ora',lang), t('act_cartonas',lang), t('act_descriere',lang)], rows:(c.fairPlay||[]).map(r=>[r.nume, r.ora||'', trEnum(r.cartonas,lang), r.descriere||'']) },
    { titleKey:'act_s_daune', headers:[t('act_numeSportiv',lang), t('act_platou',lang), t('act_descriere',lang)], rows:(c.daune||[]).map(r=>[r.nume, r.platou||'', r.descriere||'']) },
    { titleKey:'act_s_inventar', headers:[t('act_tipMiscare',lang), t('act_articol',lang), t('act_conditie',lang), t('act_cantitate',lang), t('act_motiv',lang)], rows:(c.inventar||[]).map(r=>[trEnum(r.tip,lang), r.articol, actConditieLabel(r.conditie,lang), r.cantitate, actReasonText(r.motiv, lang)]) },
    { titleKey:'act_s_hostel', headers:[t('act_numeSportiv',lang), t('act_camera',lang), t('act_oraCazarii',lang), t('act_statut',lang)], rows:(c.hostel||[]).map(r=>[r.nume, actRoomNumber(r.camera), r.ora||'', trEnum(r.statut,lang)]) },
    { titleKey:'act_s_treninguri', headers:[t('act_numeSportiv',lang), t('act_antrenor',lang), t('act_data',lang), t('act_ora',lang), t('act_statut',lang)], rows:(c.treninguri||[]).map(r=>[r.nume, r.antrenor, r.data?fmtDate(r.data):'', r.ora||'', r.statut==='programat'?t('act_programat',lang):t('act_desfasurat',lang)]) },
    { titleKey:'act_s_sarcini', headers:[t('act_statut',lang), t('act_descriere',lang)], rows:(c.sarcini||[]).map(r=>[trEnum(r.statut,lang), r.descriere||'']) },
    { titleKey:'act_s_observatii', headers:[t('ob_target',lang), t('th_categorie',lang), t('act_descriere',lang)], rows:(c.observatii||[]).map(r=>[r.nume||'—', r.categorie?trEnum(r.categorie,lang):'—', r.descriere||'']) },
    { titleKey:'act_s_pauzatehnica', headers:[t('act_teren',lang), t('act_interval',lang), t('act_durata',lang), t('act_descriere',lang)], rows:(c.pauzeTehnice||[]).map(r=>{
      const durata = r.durata!=null ? r.durata : pauzaDurata(r.oraStart, r.oraStop);
      return [r.teren||'', r.oraStart&&r.oraStop ? `${r.oraStart} — ${r.oraStop}` : '', durata==null ? '' : `${durata} ${t('pt_minSuffix',lang)}`, r.descriere||''];
    }) },
  ];
}
function actSectionTable(titleKey, headers, rows, lang=LANG){
  return `<div class="act-section">
    <div class="act-section-title">${t(titleKey,lang)}</div>
    <table class="act-table act-table-${titleKey}">
      <thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.length ? rows.map(r=>`<tr>${r.map(cell=>`<td>${cell===''||cell==null?'—':esc(cell)}</td>`).join('')}</tr>`).join('') : `<tr class="act-empty-row"><td colspan="${headers.length}">${t('act_goale',lang)}</td></tr>`}</tbody>
    </table>
  </div>`;
}
function actStampHtml(dateIso, lang=LANG){
  const [y,m,d] = (dateIso||todayISO()).split('-');
  const monthAbbr = (MONTH_NAMES[lang==='ru'?'ru':'ro'][Number(m)-1]||'').slice(0,3).toUpperCase();
  return `<div class="act-stamp"><div>${esc(monthAbbr)}<b>${esc(d)}</b>${esc(y)}</div></div>`;
}
function renderActDoc(act, lang=LANG){
  const c = act.continut || {};
  const dateLabel = fmtDate(act.data);
  return `
  <div class="act-doc">
    <div class="act-doc-head">
      <div>
        <div class="act-doc-eyebrow">${lang==='ru'?'BSKT Cup · Электронный журнал':'BSKT Cup · Registru electronic'}</div>
        <div class="act-doc-title">${t('act_docTitle',lang)}</div>
        <div class="act-doc-meta"><b>${t('act_dataSchimb',lang)}:</b> ${dateLabel} &nbsp;·&nbsp; <b>${t('act_numeAdmin',lang)}:</b><span class="act-admin-name">${esc(c.admin?.nume || act.numeAdministrator)}</span></div>
      </div>
      ${actStampHtml(act.data,lang)}
    </div>
    ${actSections(c,lang).map(s=>actSectionTable(s.titleKey, s.headers, s.rows,lang)).join('')}
  </div>`;
}
function actFileBase(act, lang=LANG){
  return `Raport-schimb_${act.data}_${String(act.numeAdministrator||'').trim().replace(/\s+/g,'-')}_${lang.toUpperCase()}`;
}
function exportActExcel(act, lang=actExportLanguage){
  if(!act) return;
  if(!window.XLSX){ alert(t('re_noExcel',lang)); return; }
  const sections = actSections(act.continut || {},lang);
  const rows = [
    [t('act_docTitle',lang).toUpperCase()],
    [`${t('act_dataSchimb',lang)}: ${fmtDate(act.data)}    ${t('act_numeAdmin',lang)}: ${act.numeAdministrator||''}`],
    [],
  ];
  const boldRowIdx = [0];
  sections.forEach(s=>{
    boldRowIdx.push(rows.length);
    rows.push([t(s.titleKey,lang)]);
    rows.push(s.headers);
    if(s.rows.length) s.rows.forEach(r=>rows.push(r.map(cell=>cell===''||cell==null?'—':cell)));
    else rows.push([t('act_goale',lang)]);
    rows.push([]);
  });
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{wch:26},{wch:22},{wch:42},{wch:16}];
  const titleStyle = { font:{bold:true,sz:14,color:{rgb:'C8A96E'}}, fill:{fgColor:{rgb:'111820'}} };
  const sectionStyle = { font:{bold:true,color:{rgb:'FFFFFF'}}, fill:{fgColor:{rgb:'343D49'}} };
  boldRowIdx.forEach((r,i)=>{
    const cell = sheet[XLSX.utils.encode_cell({r,c:0})];
    if(cell) cell.s = i===0 ? titleStyle : sectionStyle;
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, lang==='ru'?'Отчёт':'Raport');
  XLSX.writeFile(workbook, actFileBase(act,lang)+'.xlsx');
}
/* jsPDF's built-in fonts (Helvetica/Times/Courier) only cover WinAnsi — no Cyrillic, and Romanian
   ș/ț get silently mangled once anything outside that range appears earlier in the same document.
   Embed a real Unicode font (Noto Sans, subset to Latin+Cyrillic) so RO/RU text renders correctly
   instead of being transliterated or garbled. */
let pdfFontBase64 = null;
let pdfFontBoldBase64 = null;
// The bundled PDF fonts (~585 KB) are only needed for PDF exports: load them on first use.
let pdfFontsScriptPromise = null;
function loadPdfFontsScript(){
  if(window.ACT_PDF_FONTS) return Promise.resolve();
  if(!pdfFontsScriptPromise){
    pdfFontsScriptPromise = new Promise(resolve=>{
      const el = document.createElement('script');
      el.src = 'act-pdf-fonts.js?v=20260731-1';
      el.onload = resolve;
      el.onerror = ()=>{ pdfFontsScriptPromise = null; resolve(); };   // falls back to fonts/NotoSans-Regular-subset.ttf below
      document.head.appendChild(el);
    });
  }
  return pdfFontsScriptPromise;
}
async function ensurePdfFont(doc){
  if(!pdfFontBase64) await loadPdfFontsScript();
  if(!pdfFontBase64){
    // A bundled font keeps PDF export working when the app is opened via file://,
    // where browsers block fetch() calls for local font files.
    pdfFontBase64 = window.ACT_PDF_FONTS?.['LiberationSans-Regular.ttf'] || null;
    if(!pdfFontBase64){
      const res = await fetch('fonts/NotoSans-Regular-subset.ttf');
      if(!res.ok) throw new Error('font fetch failed: ' + res.status);
      const bytes = new Uint8Array(await res.arrayBuffer());
      let binary = '';
      const chunk = 0x8000;
      for(let i=0; i<bytes.length; i+=chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i+chunk));
      pdfFontBase64 = btoa(binary);
    }
  }
  pdfFontBoldBase64 = pdfFontBoldBase64 || window.ACT_PDF_FONTS?.['LiberationSans-Bold.ttf'] || pdfFontBase64;
  doc.addFileToVFS('NotoSans-Regular.ttf', pdfFontBase64);
  doc.addFileToVFS('NotoSans-Bold.ttf', pdfFontBoldBase64);
  doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
  doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
  doc.setFont('NotoSans','normal');
}
function pdfCell(value){ return value===''||value==null ? '-' : String(value); }
const ACT_PDF_COLUMNS = {
  act_s_meciuri:[.08,.12,.32,.16,.32],
  act_s_intarzieri:[.34,.13,.53],
  act_s_arbitraj:[.36,.64],
  act_s_fairplay:[.34,.12,.17,.37],
  act_s_daune:[.31,.18,.51],
  act_s_inventar:[.18,.25,.11,.09,.37],
  act_s_hostel:[.35,.12,.25,.28],
  act_s_treninguri:[.29,.18,.17,.11,.25],
  act_s_sarcini:[.24,.76],
  act_s_observatii:[.31,.22,.47],
  act_s_pauzatehnica:[.16,.20,.13,.51],
};
function actPdfColumnStyles(titleKey, width){
  const proportions = ACT_PDF_COLUMNS[titleKey] || [];
  const styles = Object.fromEntries(proportions.map((value,index)=>[index,{cellWidth:width*value}]));
  if(titleKey==='act_s_hostel' || titleKey==='act_s_pauzatehnica'){
    if(styles[1]) styles[1].halign = 'center';
    if(styles[2]) styles[2].halign = 'center';
  }
  return styles;
}
const ACT_PDF_PAPER = [243,238,224];
const ACT_PDF_INK = [33,29,20];
const ACT_PDF_MUTED = [138,127,99];
const ACT_PDF_RULE = [217,207,178];
function drawActPdfPaper(doc){
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFillColor(...ACT_PDF_PAPER);
  doc.rect(0,0,pageWidth,pageHeight,'F');
  doc.setDrawColor(237,231,214);
  doc.setLineWidth(.08);
  for(let y=7;y<pageHeight-5;y+=7.1) doc.line(10,y,pageWidth-10,y);
}
function drawActPdfHeader(doc,act,lang){
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont('NotoSans','normal');
  doc.setTextColor(...ACT_PDF_MUTED);
  doc.setFontSize(6.8);
  if(doc.setCharSpace) doc.setCharSpace(.65);
  doc.text(lang==='ru'?'BSKT CUP · ЭЛЕКТРОННЫЙ ЖУРНАЛ':'BSKT CUP · REGISTRU ELECTRONIC',13,13);
  if(doc.setCharSpace) doc.setCharSpace(0);

  doc.setFont(lang==='ru'?'NotoSans':'times',lang==='ru'?'normal':'bold');
  doc.setTextColor(...ACT_PDF_INK);
  doc.setFontSize(18);
  doc.text(t('act_docTitle',lang),13,23);

  doc.setFont('NotoSans','normal');
  doc.setFontSize(8.2);
  doc.setTextColor(91,83,64);
  const dateMeta = `${t('act_dataSchimb',lang)}: ${fmtDate(act.data)}  ·  `;
  const adminMeta = `${t('act_numeAdmin',lang)}: `;
  doc.text(dateMeta,13,31);
  const adminMetaX = 13 + doc.getTextWidth(dateMeta);
  doc.text(adminMeta,adminMetaX,31);
  const adminNameX = adminMetaX + doc.getTextWidth(adminMeta);
  const adminName = String(act.numeAdministrator||'').trim() || '-';
  const adminNameMaxWidth = Math.max(24,pageWidth-41-adminNameX);
  const targetAdminNameSize = 11.5;
  doc.setFont('NotoSans','bold');
  doc.setFontSize(targetAdminNameSize);
  const naturalNameWidth = doc.getTextWidth(adminName);
  const adminNameFontSize = naturalNameWidth > adminNameMaxWidth
    ? Math.max(8.8,targetAdminNameSize*(adminNameMaxWidth/naturalNameWidth))
    : targetAdminNameSize;
  doc.setFontSize(adminNameFontSize);
  doc.setTextColor(...ACT_PDF_INK);
  doc.text(adminName,adminNameX,31,{maxWidth:adminNameMaxWidth});

  const [year,month,day] = String(act.data||todayISO()).split('-');
  const monthLabel = (MONTH_NAMES[lang==='ru'?'ru':'ro'][Number(month)-1]||'').slice(0,3).toUpperCase();
  const stampX = pageWidth-27;
  const stampY = 22;
  doc.setDrawColor(163,73,47);
  doc.setTextColor(163,73,47);
  doc.setLineWidth(.7);
  doc.circle(stampX,stampY,11.5,'S');
  doc.setFont(lang==='ru'?'NotoSans':'times',lang==='ru'?'normal':'bold');
  doc.setFontSize(6.8);
  doc.text(monthLabel,stampX,stampY-3.2,{align:'center',angle:-7});
  doc.setFontSize(10.5);
  doc.text(day||'',stampX,stampY+1.5,{align:'center',angle:-7});
  doc.setFontSize(6.8);
  doc.text(year||'',stampX,stampY+6,{align:'center',angle:-7});

  doc.setDrawColor(...ACT_PDF_INK);
  doc.setLineWidth(.65);
  doc.line(13,40,pageWidth-13,40);
}
function drawActPdfEmptyCards(doc,sections,x,y,width,fontSize,lang,cardsPerRow=3){
  const gap = 2;
  const cardHeight = 7.5;
  for(let i=0;i<sections.length;i+=cardsPerRow){
    const pair = sections.slice(i,i+cardsPerRow);
    const cardWidth = (width-gap*(pair.length-1))/pair.length;
    pair.forEach((section,index)=>{
      const cardX = x+index*(cardWidth+gap);
      doc.setFillColor(...ACT_PDF_PAPER);
      doc.setDrawColor(...ACT_PDF_RULE);
      doc.roundedRect(cardX,y,cardWidth,cardHeight,1.1,1.1,'FD');
      doc.setFont('NotoSans','normal');
      doc.setFontSize(Math.min(fontSize,5.5));
      doc.setTextColor(...ACT_PDF_MUTED);
      doc.text(`${t(section.titleKey,lang)} - ${t('act_noEntries',lang)}`,cardX+cardWidth/2,y+4.8,{align:'center',maxWidth:cardWidth-3});
    });
    y += cardHeight+1.5;
  }
  return y;
}
function drawActPdfTable(doc,section,x,y,width,fontSize,lang){
  const pageWidth = doc.internal.pageSize.getWidth();
  const padding = fontSize<=4.4 ? .45 : fontSize<=5.2 ? .55 : .7;
  doc.autoTable({
    startY:y,
    head:[
      [{content:t(section.titleKey,lang).toUpperCase(),colSpan:section.headers.length}],
      section.headers.map(header=>String(header).toUpperCase()),
    ],
    body:section.rows.map(row=>row.map(pdfCell)),
    theme:'plain',
    tableWidth:width,
    margin:{left:x,right:pageWidth-x-width,top:45,bottom:7},
    styles:{font:'NotoSans',fontStyle:'normal',fontSize,cellPadding:padding,fillColor:ACT_PDF_PAPER,lineColor:ACT_PDF_RULE,lineWidth:{top:0,right:0,bottom:.12,left:0},overflow:'linebreak',textColor:ACT_PDF_INK},
    headStyles:{font:'NotoSans',fontStyle:'normal',fontSize,fillColor:ACT_PDF_PAPER,textColor:ACT_PDF_MUTED,cellPadding:padding,lineColor:ACT_PDF_RULE,lineWidth:{top:0,right:0,bottom:.16,left:0}},
    columnStyles:actPdfColumnStyles(section.titleKey,width),
    pageBreak:'avoid',
    rowPageBreak:'avoid',
    didParseCell:data=>{
      if(data.section==='head' && data.row.index===0){
        data.cell.styles.fontSize = fontSize+1.2;
        data.cell.styles.textColor = [107,95,67];
        data.cell.styles.cellPadding = {top:1.35,right:padding,bottom:1.1,left:0};
        data.cell.styles.lineWidth = {top:0,right:0,bottom:.22,left:0};
      }else if(data.section==='head'){
        data.cell.styles.fontSize = Math.max(3.8,fontSize-.6);
        data.cell.styles.cellPadding = {top:1,right:padding,bottom:.9,left:padding};
      }
      const centeredCell = (section.titleKey==='act_s_hostel' || section.titleKey==='act_s_pauzatehnica')
        && (data.column.index===1 || data.column.index===2)
        && (data.section==='body' || (data.section==='head' && data.row.index===1));
      if(centeredCell) data.cell.styles.halign = 'center';
    },
  });
  return doc.lastAutoTable.finalY+2.2;
}
async function buildActPdfDocument(act,lang,fontSize=6.2){
  const doc = new window.jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
  await ensurePdfFont(doc);
  drawActPdfPaper(doc);
  drawActPdfHeader(doc,act,lang);
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 13;
  const contentWidth = pageWidth-margin*2;
  const sections = actSections(act.continut||{},lang);
  let y = 46;
  const emptySections = sections.filter(section=>!section.rows.length);
  if(emptySections.length) y = drawActPdfEmptyCards(doc,emptySections,margin,y,contentWidth,fontSize,lang,3)+.4;
  sections.filter(section=>section.rows.length).forEach(section=>{ y=drawActPdfTable(doc,section,margin,y,contentWidth,fontSize,lang); });
  return doc;
}
async function exportActPdf(act,lang=actExportLanguage){
  if(!act) return;
  if(!window.jspdf?.jsPDF){ alert(t('re_noPdf',lang)); return; }
  let doc;
  try{
    const fontSizes = [12,11.5,11,10.5,10,9.5,9,8.5,8,7.6,7.2,6.8,6.4,6,5.6,5.2,4.8,4.4,4,3.8];
    doc = await buildActPdfDocument(act,lang,fontSizes[0]);
    if(doc.internal.getNumberOfPages()>1){
      let first = 1;
      let last = fontSizes.length-1;
      let fittedDoc = null;
      while(first<=last){
        const index = Math.floor((first+last)/2);
        const candidate = await buildActPdfDocument(act,lang,fontSizes[index]);
        if(candidate.internal.getNumberOfPages()===1){
          fittedDoc = candidate;
          last = index-1;
        }else{
          first = index+1;
        }
      }
      doc = fittedDoc || await buildActPdfDocument(act,lang,fontSizes[fontSizes.length-1]);
    }
  }catch(e){
    alert('PDF-ul nu s-a putut genera: '+e.message);
    return;
  }
  doc.save(actFileBase(act,lang)+'.pdf');
}
let pastShiftsForAct = null; // null = not loaded yet
async function loadPastShiftsForAct(){
  const { data, error } = await sb.from('sesiuni_schimb').select('*').not('ended_at','is',null).order('ended_at',{ascending:false}).limit(30);
  if(error){ alert('Nu s-au putut încărca schimburile: ' + error.message); return; }
  pastShiftsForAct = data||[];
  render();
}
async function generateActForPastShift(){
  const select = document.getElementById('act-past-select');
  if(!select || !select.value) return;
  const sesiune = pastShiftsForAct.find(s=>s.id===select.value);
  if(!sesiune) return;
  const employee = DB.serviciuAdministratori.find(a=>a.id===sesiune.administrator_serviciu_id);
  const numeAdministrator = employee?.nume || '—';
  const btn = document.getElementById('act-past-generate-btn');
  if(btn){ btn.disabled = true; btn.textContent = t('act_generating'); }
  try{
    const act = await saveActSchimb({
      shiftId: sesiune.id,
      administratorServiciuId: sesiune.administrator_serviciu_id,
      administratorId: null,
      numeAdministrator,
      startedAt: sesiune.started_at,
      endedAt: sesiune.ended_at,
    });
    await logAction(`A generat raportul de schimb (retroactiv) pentru ${numeAdministrator}`);
    render();
    openActPreview(act);
  } catch(error){
    alert('Generarea actului a eșuat: ' + error.message);
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = t('act_btnGenerate'); }
  }
}
function renderActeSchimbList(){
  const acts = DB.acteSchimb || [];
  const canDelete = isFullAdmin();
  const generatedShiftIds = new Set(acts.map(a=>a.inceputPerioada).filter(Boolean));
  return `
  ${isFullAdmin() ? `<div class="add-form">
    <div class="form-title">${t('act_pastTitle')}</div>
    ${pastShiftsForAct === null ? `<button class="btn-ghost" onclick="loadPastShiftsForAct()">${t('act_pastLoad')}</button>` : `
    <div class="form-grid" style="grid-template-columns:1fr auto">
      <div class="field"><label>${t('act_pastPick')}</label><select id="act-past-select">${pastShiftsForAct.length ? pastShiftsForAct.map(s=>{
        const employee = DB.serviciuAdministratori.find(a=>a.id===s.administrator_serviciu_id);
        const already = generatedShiftIds.has(s.started_at);
        return `<option value="${s.id}">${fmtDateTime(s.started_at)} → ${fmtDateTime(s.ended_at)} — ${esc(employee?.nume||'—')}${already?' '+t('act_pastAlready'):''}</option>`;
      }).join('') : `<option value="">${t('act_pastNone')}</option>`}</select></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" id="act-past-generate-btn" ${pastShiftsForAct.length?'':'disabled'} onclick="generateActForPastShift()">${t('act_btnGenerate')}</button></div>
    </div>`}
  </div>` : ''}

  <div class="table-wrap">
    <div class="table-header"><div><div class="table-title">${t('act_sectionTitle')}</div><div class="view-sub" style="margin:4px 0 0">${t('act_sectionSub')}</div></div></div>
    <div class="table-scroll reports-list-scroll ${acts.length>10?'has-overflow':''}"><table>
      <thead><tr><th>${t('th_data')}</th><th>${t('act_numeAdmin')}</th><th></th>${canDelete?'<th></th>':''}</tr></thead>
      <tbody>${acts.length ? acts.map(a=>`<tr><td class="td-muted">${fmtDate(a.data)}</td><td>${esc(a.numeAdministrator)}</td>
        <td><button class="btn-ghost btn-sm" data-act-id="${esc(a.id)}" onclick="openActPreviewById(this.dataset.actId)">${t('act_docTitle')}</button></td>
        ${canDelete?`<td><button class="btn-danger btn-sm" onclick="removeRow('acte_schimb','${a.id}')">${t('btn_delete')}</button></td>`:''}</tr>`).join('') : `<tr><td class="td-empty" colspan="${canDelete?4:3}">${t('act_none')}</td></tr>`}</tbody>
    </table></div>
  </div>`;
}

async function stopDashboardShift(){
  if(isFullAdmin()){
    // the admin "shift" is only a demo panel: close it without touching sesiuni_schimb
    adminDemoShiftActive = false; demoShiftArbitrajIds = []; dashboardRefereeEditId = null;
    render(); return;
  }
  if(!currentShift) return;
  if(!(await ensureCurrentAppBuild())) return;
  const shiftId = currentShift.id;
  const { data:reports, error:reportError } = await sb.from('acte_schimb').select('id').eq('sesiune_schimb_id',shiftId).limit(1);
  if(reportError){ alert(t('sh_reportCheckError')+' '+reportError.message); return; }
  if(!reports?.length){
    alert(t('sh_reportRequired'));
    document.getElementById('act-generate-btn')?.focus();
    return;
  }
  if(!window.confirm(t('sh_stopConfirm'))) return;
  const endedAt = new Date().toISOString();
  const shiftName = currentShift.administrator;
  try{
    // The earlier button press is a preview/checkpoint. Immediately before closing, replace it
    // with a final server-built snapshot through the exact end time while editing is still allowed.
    await saveActSchimb({
      shiftId,
      administratorServiciuId:currentShift.administratorServiciuId,
      administratorId:null,
      numeAdministrator:shiftName,
      startedAt:currentShift.startedAt,
      endedAt,
    });
  }catch(reportError){
    alert(t('sh_reportFinalizeError')+' '+reportError.message);
    return;
  }
  const { data, error } = await sb.from('sesiuni_schimb').update({ended_at:endedAt}).eq('id',currentShift.id).select();
  if(error){ alert(t('sh_stopError')+' '+error.message); return; }
  if(!data?.length){
    // Nothing matched — most likely this shift was already ended elsewhere (another tab/device
    // sharing the location login, or an admin closed it). Resync from the server instead of
    // leaving the UI stuck showing a "live" shift that no longer exists.
    alert(t('sh_stopAlreadyEnded'));
    currentShift = null;
    hideRefreshReminder();
    dashboardRefereeEditId = null;
    dashboardTrainingRows = 1;
    await fetchAll();
    document.getElementById('sb-admin').textContent = currentShift ? currentShift.administrator : currentAdmin;
    currentView = 'dashboard';
    buildSidebar();
    render();
    return;
  }
  await logAction(`A încheiat schimbul de locație: ${shiftName}`);
  currentShift = null;
  hideRefreshReminder();
  dashboardRefereeEditId = null;
  dashboardTrainingRows = 1;
  document.getElementById('sb-admin').textContent = currentAdmin;
  currentView = 'dashboard';
  buildSidebar();
  render();
}
function addDashboardTrainingRow(){
  dashboardTrainingRows = Math.min(8, dashboardTrainingRows + 1);
  render();
}
function renderShiftWorkflow(){
  const active = isFullAdmin() ? adminDemoShiftActive : !!currentShift;
  if(!active){
    return `<section class="shift-launch">
      <div class="shift-launch-icon">${icon('play')}</div>
      <h3>${t('sh_startTitle')}</h3>
      <p>${t('sh_startSub')}</p>
      ${shiftStartPrompt && !isFullAdmin() ? `<div class="shift-start-confirm">
        ${DB.serviciuAdministratori.length ? `<div class="field"><label>${t('sh_chooseName')}</label><select id="shift-employee">${serviceEmployeeOptions('')}</select></div>` : `<div class="te-problems" style="margin:0">${t('sh_faraPersonal')}</div>`}
        <button class="btn-primary" onclick="confirmLocationShift()">${t('sh_confirmStart')}</button>
      </div>` : `<button class="btn-primary" onclick="openShiftPanel()">${t('sh_startBtn')}</button>`}
    </section>`;
  }

  const refs = dashboardArbitrajRows();
  const eligible = eligibleTrainingParticipants();
  const todayTrainings = DB.treninguri.filter(r=>r.data===todayISO()).sort((a,b)=>String(a.ora||'').localeCompare(String(b.ora||'')));
  const startedAt = isFullAdmin() ? new Date().toISOString() : currentShift.startedAt;
  const shiftName = activeShiftName();
  return `<section class="daily-ops">
    <div class="daily-ops-head">
      <div class="shift-identity"><span class="shift-live-dot"></span><div><strong>${esc(shiftName)}</strong><span>${t(isFullAdmin()?'sh_demo':'sh_active')} · ${fmtDateTime(startedAt)}</span></div></div>
      <div style="display:flex;gap:10px">
        <button class="btn-ghost" id="act-generate-btn" onclick="generateActSchimb()">${t('act_btnGenerate')}</button>
        <button class="btn-stop-shift" onclick="stopDashboardShift()">${t('sh_stop')}</button>
      </div>
    </div>
    <div class="daily-ops-grid">
      <div class="ops-card">
        <div class="ops-title"><span>${t('sh_refTitle')}</span><span class="ops-kicker">01</span></div>
        <div class="ops-help">${t('sh_refHelp')}</div>
        ${[1,2,3].map(slot=>{
          const saved = refs.find(r=>r.slotSchimb===slot) || (isFullAdmin() ? refs[slot-1] : null);
          const editing = !!saved && dashboardRefereeEditId===saved.id;
          return `<div class="ops-row">
            <div class="field"><div class="ops-slot">#${slot} · ${t('sh_referee')} ${saved?'<span class="ops-saved">· '+t(editing?'sh_correcting':'sh_saved')+'</span>':''}</div>
              ${editing ? `<select id="shift-ref-correction-${saved.id}">${dashboardRefereeOptions(saved.arbitru)}</select>` : saved ? `<input value="${esc(saved.arbitru)}" disabled>` : `<select id="shift-ref-${slot}">${dashboardRefereeOptions('')}</select>`}
            </div>
            <div class="field"><label>${t('sh_venue')}</label>${editing ? `<select id="shift-venue-correction-${saved.id}">${dashboardVenueOptions(saved.turneu)}</select>` : saved ? `<input value="${esc(saved.turneu)}" disabled>` : `<select id="shift-venue-${slot}">${dashboardVenueOptions('')}</select>`}</div>
            ${saved ? `<div class="field"><label>${t('sh_balls')}</label><input id="shift-ball-qty-${saved.id}" type="number" min="0" value="${saved.cantitateMingi||0}" ${editing?'disabled':''}></div>
              <div class="field"><label>${t('ar_interval')}</label><div class="ar-time-edit"><input id="shift-ref-start-${saved.id}" type="time" value="${esc(saved.oraStart||'')}" ${editing?'disabled':''}><input id="shift-ref-stop-${saved.id}" type="time" value="${esc(saved.oraStop||'')}" ${editing?'disabled':''}></div></div>
              <div class="ops-actions">${editing ? `<button class="btn-primary btn-sm" onclick="saveDashboardRefereeCorrection('${saved.id}')">${t('sh_saveCorrection')}</button><button class="btn-ghost btn-sm" onclick="cancelDashboardRefereeCorrection()">${t('sh_cancelCorrection')}</button>` : `<button class="btn-ghost btn-sm" onclick="updateDashboardRefereeBalls('${saved.id}')">${t('sh_updateBalls')}</button><button class="btn-ghost btn-sm" onclick="beginDashboardRefereeCorrection('${saved.id}')">${t('sh_correctRef')}</button>`}</div>`
              : `<div></div><button class="btn-primary btn-sm" onclick="saveDashboardReferee(${slot})">${t('sh_saveRef')}</button>`}
          </div>`;
        }).join('')}
      </div>

      <div class="ops-card">
        <div class="ops-title"><span>${t('sh_inventoryTitle')}</span><span class="ops-kicker">02</span></div>
        <div class="ops-help">${t('sh_inventoryHelp')}</div>
        <div class="ops-row inventory-row">
          <div class="field"><label>${t('sh_item')}</label><select id="shift-inventory-item">${inventarSorted().map(i=>`<option value="${i.id}">${esc(trEnum(i.denumire))}${i.marime!=='—'?' — '+esc(i.marime):''}</option>`).join('')}</select></div>
          <div class="field"><label>${t('sh_quantity')}</label><input id="shift-inventory-qty" type="number" min="1" value="1"></div>
          <button class="btn-primary btn-sm" onclick="addDashboardInventory()">${t('sh_addStock')}</button>
        </div>
      </div>

      <div class="ops-card">
        <div class="ops-title"><span>${t('sh_matchesTitle')}</span><span class="ops-kicker">03</span></div>
        <div class="ops-help">${t('sh_matchesHelp')}</div>
        <div class="ops-today-list">${DB.meciuri.filter(m=>m.data===todayISO()).sort((a,b)=>(a.nr||0)-(b.nr||0)).map(m=>`<span class="ops-today-chip">#${m.nr??''} ${esc(echipaName(m.echipaAId))} ${m.scorA??'–'}:${m.scorB??'–'} ${esc(echipaName(m.echipaBId))}</span>`).join('') || `<span class="td-muted">${t('mt_none')}</span>`}</div>
        <button class="btn-primary btn-sm" style="margin-top:10px" onclick="navigate('meciuri')">${t('sh_matchesOpen')}</button>
      </div>
    </div>
  </section>`;
}

/* ── Helper dashboard: everything that needs attention, grouped by urgency, each row links to the page
   where it can be seen. Data that needs extra queries (line-ups, pay this week, results sync) loads once
   in the background and redraws the dashboard when it arrives. ── */
let asDash = null;   // { loading, rosterIds:Set, week:{brut,meciuri}, sync }
async function loadAsistentDashboard(){
  if(asDash) return;
  asDash = { loading:true };
  const today = todayISO(), from = addDays(today, -60), wk = weekStart(today);
  const [rosterIds, week, sync] = await Promise.all([
    ICON_PREVIEW_MODE ? Promise.resolve(new Set([...rosterByMatch].filter(([,r])=>r.length).map(([id])=>id))) : loadStatsRosterIds(from, today).catch(e=>{ console.error(e); return null; }),
    loadStats(wk, today).then(st=>({ brut: st.jucatori.reduce((x,j)=>x+(j.totalBrut||0),0), jucatori: st.jucatori.length })).catch(e=>{ console.error(e); return null; }),
    ICON_PREVIEW_MODE ? Promise.resolve({ rulat_la:new Date().toISOString(), ok:true }) : sb.from('sync_rezultate').select('rulat_la,ok,eroare,ignorate').order('id',{ascending:false}).limit(1).then(r=>r.data?.[0]||null),
  ]);
  asDash = { loading:false, rosterIds, week, sync, from };
  if(currentView==='dashboard') render();
}
function asistentProblems(){
  const today = todayISO(), out = [];
  const add = (level, type, text, go)=>out.push({ level, type, text, go });
  const names = (list, max=4)=>list.slice(0,max).join(', ') + (list.length>max ? ` +${list.length-max}` : '');
  // pay: scored matches without a line-up → those players are not paid
  if(asDash?.rosterIds){
    const missing = DB.meciuri.filter(m=>winnerOf(m) && m.data>=asDash.from && !asDash.rosterIds.has(m.id));
    [...new Set(missing.map(m=>m.data))].sort().reverse().forEach(d=>{
      const n = missing.filter(m=>m.data===d).length;
      add('red', 'lineup', t('as_pLot')(fmtDate(d), n), `goToMatchDay('${d}')`);
    });
  }
  // past matches still without a score
  const noScore = DB.meciuri.filter(m=>m.data<today && !winnerOf(m));
  if(noScore.length) add('yellow', 'match', t('as_pFaraScor')(noScore.length, fmtDate(noScore.map(m=>m.data).sort().pop())), `goToMatchDay('${noScore.map(m=>m.data).sort().pop()}')`);
  // results feed health
  if(asDash?.sync){
    const hrs = (Date.now() - new Date(asDash.sync.rulat_la).getTime())/3600000;
    if(!asDash.sync.ok) add('red', 'sync', t('as_pSyncEroare')(fmtDateTime(asDash.sync.rulat_la), asDash.sync.eroare||''), `navigate('meciuri')`);
    else if(hrs > 3) add('yellow', 'sync', t('as_pSyncVechi')(fmtDateTime(asDash.sync.rulat_la)), `navigate('meciuri')`);
    if(asDash.sync.ignorate > 0) add('yellow', 'sync', t('as_pSyncIgnorate')(asDash.sync.ignorate), `navigate('meciuri')`);
  } else if(asDash && !asDash.loading) add('yellow', 'sync', t('as_pSyncNiciodata'), `navigate('meciuri')`);
  // referees: two on a day without hours (paid 0 until filled), or more than two
  const refDays = {};
  DB.arbitraj.filter(a=>a.data>=addDays(today,-45)).forEach(a=>{ (refDays[a.data] ||= []).push(a); });
  Object.entries(refDays).sort().reverse().forEach(([d, rows])=>{
    const noHours = [...new Set(rows.filter(r=>refereeHours(r)==null).map(r=>r.arbitru))];
    if(noHours.length && d < today) add('red', 'referee', t('as_pOreLipsa')(fmtDate(d), names(noHours)), `navigate('arbitraj')`);
  });
  // medical certificates
  const med = medicalRows();
  const expired = med.filter(r=>r.status==='expirat').map(r=>r.nume), soon = med.filter(r=>r.status==='expiră curând').map(r=>r.nume);
  if(expired.length) add('red', 'medical', t('as_pAvizExpirat')(expired.length, names(expired)), `navigate('medical')`);
  if(soon.length) add('yellow', 'medical', t('as_pAvizCurand')(soon.length, names(soon)), `navigate('medical')`);
  // teams: too few active players / active players with no team
  echipeActive().forEach(e=>{
    const n = DB.participanti.filter(p=>p.echipaId===e.id && p.statut==='activ' && p.rolEchipa!=='arbitru').length;
    if(n < 3) add('yellow', 'team', t('as_pEchipaMica')(e.nume, n), `navigate('echipe')`);
  });
  const noTeam = DB.participanti.filter(p=>p.statut==='activ' && !p.echipaId).map(p=>`${p.nume} ${p.prenume}`);
  if(noTeam.length) add('info', 'team', t('as_pFaraEchipa')(noTeam.length, names(noTeam)), `participantTeamFilter='__none__'; navigate('participanti')`);
  // discipline (last 7 days) and repeated lateness (30 days)
  // items out and not back
  const laundryOut = DB.spalatorie.filter(r=>!r.dataReturnare && r.data<addDays(today,-2));
  if(laundryOut.length) add('yellow', 'kit', t('as_pSpalatorie')(laundryOut.length), `navigate('spalatorie')`);
  const linenOut = DB.lenjerie.filter(l=>!l.dataReturnare && l.dataEliberare<addDays(today,-7));
  if(linenOut.length) add('info', 'kit', t('as_pLenjerie')(linenOut.length), `navigate('lenjerie')`);
  // stock and tasks
  lowStockItems().forEach(i=>add('yellow', 'inventory', t('al_lowStock')(`${trEnum(i.denumire)}${i.marime!=='—'?' '+i.marime:''}`, inventoryCurrent(i), i.um, i.cantitateMinima), `navigate('inventar')`));
  const stale = staleTasks(), open = DB.sarcini.filter(x=>x.status!=='soluționat' && !stale.includes(x));
  stale.forEach(x=>add('red', 'task', t('al_staleTask')(x.descriere), `navigate('sarcini')`));
  if(open.length) add('info', 'task', t('as_pSarciniDeschise')(open.length), `navigate('sarcini')`);
  const rank = { red:0, yellow:1, info:2 };
  return out.sort((x,y)=>rank[x.level]-rank[y.level]);
}
function renderAsistentDashboard(){
  loadAsistentDashboard();
  const today = todayISO(), wk = weekStart(today);
  const problems = asistentProblems();
  const reds = problems.filter(p=>p.level==='red').length;
  const med = medicalRows();
  const medExp = med.filter(r=>r.status==='expirat').length, medSoon = med.filter(r=>r.status==='expiră curând').length;
  const lastDay = DB.meciuri.filter(m=>m.data<=today && winnerOf(m)).map(m=>m.data).sort().pop();
  const lastDayMatches = lastDay ? DB.meciuri.filter(m=>m.data===lastDay) : [];
  const lastDayNoLot = asDash?.rosterIds ? lastDayMatches.filter(m=>winnerOf(m) && !asDash.rosterIds.has(m.id)).length : null;
  const missingList = asDash?.rosterIds ? DB.meciuri.filter(m=>winnerOf(m) && m.data>=asDash.from && !asDash.rosterIds.has(m.id)) : null;
  const missingAll = missingList ? missingList.length : null;
  const missingLatest = missingList?.map(m=>m.data).sort().pop();
  const card = (label, value, sub, cls='', go='')=>`<div class="stat-card ${cls} ${go?'asistent-link':''}" ${go?`onclick="${go}"`:''}><div class="stat-label">${label}</div><div class="stat-value ${cls==='crit'?'c-red':cls==='warn'?'c-yellow':''}">${value}</div><div class="stat-sub">${sub}</div></div>`;
  const loadingTxt = '…';
  return `
  <div class="view-head"><div class="view-title">${t('da_title')}</div>${syncHeaderBtn()}</div>
  <div class="view-sub">${fmtDate(today)} · ${t('as_dashSub')}</div>

  <div class="stats-row">
    ${card(t('as_cDeRezolvat'), problems.length, reds ? `${reds} ${t('as_urgente')}` : t('as_nimicUrgent'), reds?'crit':problems.length?'warn':'')}
    ${card(t('as_cFaraLot'), missingAll==null?loadingTxt:missingAll, t('as_cFaraLotSub'), missingAll?'crit':'', missingAll?`goToMatchDay('${missingLatest}')`:'')}
    ${card(t('as_cBrutSapt'), asDash?.week ? `${money(asDash.week.brut)}` : loadingTxt, asDash?.week ? `MDL · ${asDash.week.jucatori} ${plural(asDash.week.jucatori,'pa_countSuffix')} · ${t('as_dinLuni')}` : '', '', `navigate('plati')`)}
    ${card(t('as_ultimaZi'), lastDay?fmtDate(lastDay):'—', lastDay ? `${lastDayMatches.length} ${plural(lastDayMatches.length,'mt_meciuriSuffix')}${lastDayNoLot?` · <span class="c-red">${lastDayNoLot} ${t('as_faraLotScurt')}</span>`:''}` : '', '', lastDay?`goToMatchDay('${lastDay}')`:'')}
  </div>
  <div class="stats-row">
    ${card(t('da_stat_activi'), DB.participanti.filter(p=>p.statut==='activ').length, `${DB.participanti.length} ${t('da_total_inreg')} · ${echipeActive().length} ${t('as_echipeActive')}`, '', `navigate('participanti')`)}
    ${card(t('da_stat_medical'), medExp, `${trEnum('expirat')} · ${medSoon} ${t('da_expira30')} &lt;30${LANG==='ru'?' дн.':' zile'}`, medExp?'crit':medSoon?'warn':'', `navigate('medical')`)}
    ${card(t('da_stat_stoc'), lowStockItems().length, `${t('da_din')} ${DB.inventar.length} ${plural(DB.inventar.length,'da_categorii')}`, lowStockItems().length?'warn':'', `navigate('inventar')`)}
    ${card(t('da_stat_sarcini'), staleTasks().length, `${DB.sarcini.filter(x=>x.status!=='soluționat').length} ${t('da_total_lucru')}`, staleTasks().length?'crit':'', `navigate('sarcini')`)}
    ${card(t('da_stat_meciuri'), DB.meciuri.filter(m=>m.data===today).length, `${t('da_stat_meciuriSub')}: ${DB.meciuri.filter(m=>m.data>=wk).length}`, '', `goToMatchDay('${today}')`)}
    ${card(t('da_stat_hostel'), DB.hostel.filter(h=>h.dataCazare===today).length, `${t('da_total_inregistrari')}: ${DB.hostel.length}`, '', `navigate('hostel')`)}
  </div>

  <div class="alerts-panel">
    <div class="alerts-panel-head">${t('as_deRezolvatTitlu')}${asDash?.loading ? ` <span class="td-muted">· ${t('as_seIncarca')}</span>` : ''}</div>
    ${problems.length ? problems.map(a=>`<div class="alert-row clickable" onclick="${a.go}"><span class="alert-dot ${a.level==='info'?'':a.level}"></span><span class="alert-type ${a.type}">${esc(t('as_t_'+a.type))}</span><span class="alert-text">${esc(a.text)}</span><span class="alert-go">›</span></div>`).join('') : `<div class="alert-empty">${asDash?.loading ? t('as_seIncarca') : t('as_totInRegula')}</div>`}
  </div>
  ${renderAsistentLog()}
  <div class="view-sub">${t('as_doarCitire')}</div>`;
}
function renderDashboard(){
  if(isAsistent()) return renderAsistentDashboard();
  const alerts = buildAlerts();
  const cazatiAcum = DB.hostel.filter(h=>!DB.lenjerie.some(()=>false)).length; // placeholder not used
  const medExpirate = medicalRows().filter(r=>r.status==='expirat').length;
  const medCurand = medicalRows().filter(r=>r.status==='expiră curând').length;
  return `
  <div class="view-head"><div class="view-title">${t('da_title')}</div>${syncHeaderBtn()}</div>
  <div class="view-sub">${fmtDate(todayISO())} · ${isFullAdmin() ? esc(currentAdmin) : `${t('sb_shift').toLowerCase()}: ${esc(activeShiftName())}`}</div>

  ${isFullAdmin() ? '' : renderShiftWorkflow()}

  <div class="stats-row">
    <div class="stat-card"><div class="stat-label">${t('da_stat_activi')}</div><div class="stat-value">${DB.participanti.filter(p=>p.statut==='activ').length}</div><div class="stat-sub">${DB.participanti.length} ${t('da_total_inreg')}</div></div>
    <div class="stat-card ${medExpirate?'crit':medCurand?'warn':''}"><div class="stat-label">${t('da_stat_medical')}</div><div class="stat-value ${medExpirate?'c-red':medCurand?'c-yellow':''}">${medExpirate}</div><div class="stat-sub">${trEnum('expirat')} · ${medCurand} ${t('da_expira30')} &lt;30${LANG==='ru'?' дн.':' zile'}</div></div>
    <div class="stat-card ${lowStockItems().length?'warn':''}"><div class="stat-label">${t('da_stat_stoc')}</div><div class="stat-value ${lowStockItems().length?'c-yellow':''}">${lowStockItems().length}</div><div class="stat-sub">${t('da_din')} ${DB.inventar.length} ${plural(DB.inventar.length,'da_categorii')}</div></div>
    <div class="stat-card ${staleTasks().length?'crit':''}"><div class="stat-label">${t('da_stat_sarcini')}</div><div class="stat-value ${staleTasks().length?'c-red':''}">${staleTasks().length}</div><div class="stat-sub">${DB.sarcini.filter(s=>s.status!=='soluționat').length} ${t('da_total_lucru')}</div></div>
    <div class="stat-card"><div class="stat-label">${t('da_stat_meciuri')}</div><div class="stat-value">${DB.meciuri.filter(m=>m.data===todayISO()).length}</div><div class="stat-sub">${t('da_stat_meciuriSub')}: ${DB.meciuri.filter(m=>m.data>=weekStart(todayISO())).length}</div></div>
    <div class="stat-card"><div class="stat-label">${t('da_stat_hostel')}</div><div class="stat-value">${DB.hostel.filter(h=>h.dataCazare===todayISO()).length}</div><div class="stat-sub">${t('da_total_inregistrari')}: ${DB.hostel.length}</div></div>
  </div>

  ${syncStrip()}

  <div class="alerts-panel">
    <div class="alerts-panel-head">${t('da_alerts_title')}</div>
    ${alerts.length ? alerts.map(a=>`<div class="alert-row"><span class="alert-dot ${a.level}"></span><span class="alert-type ${a.type}">${esc(t(`al_type${a.type[0].toUpperCase()+a.type.slice(1)}`))}</span><span class="alert-text">${esc(a.text)}</span></div>`).join('') : `<div class="alert-empty">${t('da_alerts_empty')}</div>`}
  </div>

  ${isFullAdmin() ? renderAsistentLog() : ''}
  ${isFullAdmin() ? `<div class="table-wrap">
    <div class="table-header"><div class="table-title">${t('da_jurnal_title')}</div></div>
    <div class="table-scroll recent-actions-scroll"><table>
      <thead><tr><th>${t('th_cont')}</th><th>${t('th_data')}</th><th>${t('th_actiune')}</th></tr></thead>
      <tbody>
        ${DB.jurnal.slice(0,100).map(j=>`<tr><td class="td-muted">${esc(j.cont)}</td><td class="td-muted">${fmtDate(j.data)}</td><td>${esc(j.actiune)}</td></tr>`).join('')}
      </tbody>
    </table></div>
  </div>` : ''}`;
}

async function saveDashboardReferee(slot){
  if(!hasActiveShift()) return;
  const arbitru = document.getElementById(`shift-ref-${slot}`)?.value;
  const turneu = document.getElementById(`shift-venue-${slot}`)?.value;
  if(!arbitru || !turneu) return;
  const payload = { data:todayISO(), arbitru, turneu, cantitate_mingi:0 };
  if(!isFullAdmin()){
    payload.sesiune_schimb_id = currentShift.id;
    payload.slot_schimb = slot;
  }
  const { data:row, error } = await sb.from('arbitraj').insert(payload).select().single();
  if(error){ alert('Salvarea a eșuat: '+error.message); return; }
  const local = {id:row.id,data:row.data,arbitru:row.arbitru,turneu:row.turneu,cantitateMingi:row.cantitate_mingi,oraStart:row.ora_start?String(row.ora_start).slice(0,5):'',oraStop:row.ora_stop?String(row.ora_stop).slice(0,5):'',observatii:row.observatii,sesiuneSchimbId:row.sesiune_schimb_id,slotSchimb:row.slot_schimb};
  DB.arbitraj.unshift(local);
  if(isFullAdmin()) demoShiftArbitrajIds.push(row.id);
  await logAction(`A programat arbitrul ${arbitru} la ${turneu}`);
  render();
}
function beginDashboardRefereeCorrection(id){
  const row = DB.arbitraj.find(a=>a.id===id);
  if(!canCorrectDashboardReferee(row)) return;
  dashboardRefereeEditId = id;
  render();
}
function cancelDashboardRefereeCorrection(){
  dashboardRefereeEditId = null;
  render();
}
async function saveDashboardRefereeCorrection(id){
  const row = DB.arbitraj.find(a=>a.id===id);
  if(!canCorrectDashboardReferee(row)) return;
  const arbitru = document.getElementById(`shift-ref-correction-${id}`)?.value;
  const turneu = document.getElementById(`shift-venue-correction-${id}`)?.value;
  if(!arbitru || !turneu) return;
  const oldArbitru = row.arbitru, oldTurneu = row.turneu;
  if(arbitru===oldArbitru && turneu===oldTurneu){ dashboardRefereeEditId=null; render(); return; }
  const { data, error } = await sb.from('arbitraj').update({arbitru,turneu}).eq('id',id).select().single();
  if(error || !data){ alert(t('sh_correctionError')+' '+(error?.message||'')); return; }
  row.arbitru = data.arbitru;
  row.turneu = data.turneu;
  row.cantitateMingi = data.cantitate_mingi;
  dashboardRefereeEditId = null;
  await refetchInventar();
  await logAction(`A corectat arbitrul/sala din "${oldArbitru} / ${oldTurneu}" în "${row.arbitru} / ${row.turneu}"`);
  render();
}
async function updateDashboardRefereeBalls(id){
  if(!hasActiveShift()) return;
  const row = DB.arbitraj.find(a=>a.id===id); if(!row) return;
  const raw = parseInt(document.getElementById(`shift-ball-qty-${id}`)?.value);
  const cantitateMingi = Number.isFinite(raw) && raw>=0 ? raw : 0;
  const ora_start = document.getElementById(`shift-ref-start-${id}`)?.value || null, ora_stop = document.getElementById(`shift-ref-stop-${id}`)?.value || null;
  if((ora_start && !ora_stop) || (!ora_start && ora_stop)){ alert(t('ar_needAmbeleOre')); return; }
  const { data, error } = await sb.from('arbitraj').update({cantitate_mingi:cantitateMingi, ...((ora_start || row.oraStart) ? { ora_start, ora_stop } : {})}).eq('id',id).select();
  if(error || !data?.length){ alert('Actualizarea a eșuat: '+(error?.message||'fără permisiune')); return; }
  row.cantitateMingi = cantitateMingi; row.oraStart = ora_start||''; row.oraStop = ora_stop||'';
  await refetchInventar();
  await logAction(`A actualizat mingile pentru ${row.arbitru}: ${cantitateMingi}`);
  render();
}
async function addDashboardInventory(){
  if(!hasActiveShift()) return;
  const id = document.getElementById('shift-inventory-item')?.value;
  const cant = parseInt(document.getElementById('shift-inventory-qty')?.value)||1;
  const item = DB.inventar.find(i=>i.id===id); if(!item || cant<1) return;
  const { error } = await sb.rpc('inventar_log_intrare',{p_inventar_id:id,p_cantitate:cant,p_motiv:'Intrare înregistrată din tabloul de bord'});
  if(error){ alert('Actualizarea a eșuat: '+error.message); return; }
  await refetchInventar();
  await logAction(`A înregistrat o intrare de ${cant} ${item.um} — ${item.denumire}`);
  render();
}
async function addDashboardTraining(index){
  if(!hasActiveShift()) return;
  const participantId = document.getElementById(`shift-training-player-${index}`)?.value;
  const antrenor = document.getElementById(`shift-training-coach-${index}`)?.value;
  const ora = document.getElementById(`shift-training-time-${index}`)?.value || null;
  if(!participantId){ alert(t('an_needJucator')); return; }
  if(!ora){ alert(t('sh_time')); return; }
  const payload = {participant_id:participantId,antrenor,data:todayISO(),ora,suma_jucator:TRAINING_SUMA_JUCATOR,suma_antrenor:TRAINING_SUMA_ANTRENOR};
  const { data:saved, error } = await sb.from('treninguri').insert(payload).select().single();
  if(error){ alert('Salvarea a eșuat: '+error.message); return; }
  DB.treninguri.unshift({id:saved.id,participantId:saved.participant_id,antrenor:saved.antrenor,data:saved.data,ora:saved.ora,sumaJucator:Number(saved.suma_jucator),sumaAntrenor:Number(saved.suma_antrenor),observatii:saved.observatii});
  await logAction(`A înregistrat un antrenament pentru ${participantName(participantId)} cu ${antrenor}`);
  render();
}

/* ══════════════════════ BSKT CUP: date comune ══════════════════════ */
// Supabase returns at most 1000 rows per request; page through bigger tables.
async function selectPaged(build){
  const out = [];
  for(let from=0;; from+=1000){
    const { data, error } = await build().range(from, from+999);
    if(error) throw error;
    out.push(...(data||[]));
    if(!data || data.length < 1000) break;
  }
  return out;
}
function mapParticipant(p){
  return {
    id:p.id, nrDulap:p.nr_dulap, nume:p.nume, prenume:p.prenume, patronimic:p.patronimic,
    dataNasterii:p.data_nasterii, locNastere:p.loc_nastere, adresa:p.adresa, idnp:p.idnp,
    telefon:p.telefon, contactRezerva:p.contact_rezerva, persoanaContact:p.persoana_contact, email:p.email,
    serieAct:p.serie_act, nrAct:p.nr_act, dataEmiteriiAct:p.data_emiterii_act, stagiuSportivAni:p.stagiu_sportiv_ani,
    locMunca:p.loc_munca, functia:p.functia, profilActivitate:p.profil_activitate,
    club:p.club, echipaId:p.echipa_id, nrEchipa:p.nr_echipa, rolEchipa:p.rol_echipa||'jucător', clasament:p.clasament,
    categorieSportiva:p.categorie_sportiva, primulAntrenor:p.primul_antrenor, recomandator:p.recomandator, garantIntegritate:p.garant_integritate,
    inaltimeCm:p.inaltime_cm, greutateKg:p.greutate_kg, marime:p.marime,
    rezultateSport:p.rezultate_sport, traumatisme:p.traumatisme, contraindicatii:p.contraindicatii, altSport:p.alt_sport,
    experientaCompetitii:p.experienta_competitii, contactePariuri:p.contacte_pariuri, experientaPariere:p.experienta_pariere,
    caracteristica:p.caracteristica, informatSecuritate:!!p.informat_securitate, acordDatePersonale:!!p.acord_date_personale,
    comentarii:p.comentarii, rating:p.rating, fotoPath:p.foto_path,
    dataAvizMedical:p.data_aviz_medical, statut:p.statut, dataInregistrarii:p.data_inregistrarii,
    eligibilAntrenament:p.eligibil_antrenament, freelancer: p.freelancer!==false,
  };
}
function mapMeci(m){
  return {
    id:m.id, nr:m.nr, data:m.data, ora:m.ora ? String(m.ora).slice(0,5) : '', teren:m.teren,
    echipaAId:m.echipa_a_id, echipaBId:m.echipa_b_id, scorA:m.scor_a, scorB:m.scor_b,
    prelungiri:!!m.prelungiri, arbitru:m.arbitru, observatii:m.observatii, sesiuneSchimbId:m.sesiune_schimb_id,
    sursa:m.sursa||'manual', idExtern:m.id_extern||null, syncBaza:m.sync_baza||null,
  };
}
function mapRoster(r){
  return { id:r.id, meciId:r.meci_id, echipaId:r.echipa_id, participantId:r.participant_id, rol:r.rol,
    sumaNet:r.suma_net==null?null:Number(r.suma_net), retinere:r.retinere==null?null:Number(r.retinere), sumaBruta:r.suma_bruta==null?null:Number(r.suma_bruta) };
}
function mapTarif(r){ return { id:r.id, valabilDeLa:r.valabil_de_la, rol:r.rol, situatie:r.situatie, net:Number(r.net), retinerePct:Number(r.retinere_pct), observatie:r.observatie }; }
function echipa(id){ return DB.echipe.find(e=>e.id===id); }
function echipaName(id){ return echipa(id)?.nume || '—'; }
function echipeActive(){ return DB.echipe.filter(e=>e.activ).sort((a,b)=>a.nume.localeCompare(b.nume)); }
function teamPlayers(echipaId){
  return DB.participanti.filter(p=>p.echipaId===echipaId && p.statut==='activ')
    .sort((a,b)=>(a.nrEchipa||9)-(b.nrEchipa||9) || (b.rating||0)-(a.rating||0) || a.nume.localeCompare(b.nume,'ro'));
}
// The player's current team first; other teams they played for in the period follow, faded ("și la …").
function playerTeamsOrdered(participantId, playedIds){
  const cur = participant(participantId)?.echipaId || null;
  const others = playedIds.filter(id=>id && id!==cur);
  return { cur: cur || others.shift() || null, others };
}
function playerTeamsHtml(participantId, playedIds){
  const { cur, others } = playerTeamsOrdered(participantId, playedIds||[]);
  if(!cur) return '';
  const team = id => `<span class="pay-team-item">${teamDot(id)}${esc(echipaName(id))}</span>`;
  return `<span class="pay-team">${team(cur)}${others.length ? `<span class="pay-team-also"><span class="pay-sep">·</span>${t('sx_siLa')} ${others.map(team).join('<span class="pay-sep">,</span>')}</span>` : ''}</span>`;
}
function playerTeamsText(participantId, playedIds){
  const { cur, others } = playerTeamsOrdered(participantId, playedIds||[]);
  return cur ? echipaName(cur) + (others.length ? ` (${t('sx_siLa')} ${others.map(echipaName).join(', ')})` : '') : '';
}
function teamDot(id){
  const e = echipa(id);
  if(e?.logoUrl) return `<img class="team-logo-xs" src="${esc(e.logoUrl)}" alt="" loading="lazy">`;
  const c = e?.culoare; return c ? `<span class="team-dot" style="background:${esc(c)}"></span>` : '';
}
// session order: evening games first, then the ones after midnight (they belong to the same session day)
function matchSortKey(m){ const o = m.ora||''; return (o && o < '06:00' ? '1' : '0') + o + String(m.nr??'').padStart(6,'0'); }
// games 00:00–05:59 are filed under the evening's game day (as in the Excel) but are played on the next calendar day
function isAfterMidnight(ora){ return !!ora && String(ora).slice(0,5) < '06:00'; }
function matchTimeLabel(data, ora){ const o = String(ora||'').slice(0,5); return isAfterMidnight(o) && data ? `${o} · ${ddmm(addDays(data,1))}` : o; }
// last N played matches of a team, newest first: [{ won, own, opp, oppId, data }]
function teamForm(echipaId, n=5){
  return DB.meciuri.filter(m=>(m.echipaAId===echipaId || m.echipaBId===echipaId) && m.scorA!=null && m.scorB!=null)
    .sort((a,b)=>(b.data+matchSortKey(b)).localeCompare(a.data+matchSortKey(a))).slice(0,n)
    .map(m=>{ const home = m.echipaAId===echipaId; const own = home?m.scorA:m.scorB, opp = home?m.scorB:m.scorA;
      return { won: own>opp, own, opp, oppId: home?m.echipaBId:m.echipaAId, data:m.data }; });
}
function money(v){ const n = Number(v||0); return (Math.round(n*100)/100).toLocaleString('ro-RO',{minimumFractionDigits:n%1?2:0, maximumFractionDigits:2}); }
function pct(v){ return v==null ? '—' : Math.round(Number(v)*100)+'%'; }
function signed(v){ if(v==null) return '—'; const n=Number(v); return (n>0?'+':'')+n.toLocaleString('ro-RO'); }
function winnerOf(m){ if(m.scorA==null || m.scorB==null) return null; return m.scorA>m.scorB ? m.echipaAId : m.echipaBId; }
function canEditMatch(m){ return !isWeekLocked(m.data) && (isFullAdmin() || (!!currentShift && m.sesiuneSchimbId===currentShift.id)); }
function weekStart(iso){ const d=new Date(iso+'T00:00:00Z'); return addDays(iso, -((d.getUTCDay()+6)%7)); }
function datesBetween(from,to){ const out=[]; for(let d=from; d<=to && out.length<3700; d=addDays(d,1)) out.push(d); return out; }
function ddmm(iso){ return iso ? `${iso.slice(8,10)}.${iso.slice(5,7)}` : ''; }

// rosters are loaded per date range (they grow by ~1000 rows a week)
const rosterByMatch = new Map();
const rosterLoadedDays = new Set();
async function loadRosters(from, to){
  const missing = datesBetween(from,to).filter(d=>!rosterLoadedDays.has(d));
  if(!missing.length) return;
  const lo = missing[0], hi = missing[missing.length-1];
  const rows = await selectPaged(()=>sb.from('meci_jucatori').select('*, meciuri!inner(data)').gte('meciuri.data', lo).lte('meciuri.data', hi).order('id'));
  const ids = new Set(DB.meciuri.filter(m=>m.data>=lo && m.data<=hi).map(m=>m.id));
  ids.forEach(id=>rosterByMatch.set(id, []));
  rows.forEach(r=>{ const x = mapRoster(r); if(!rosterByMatch.has(x.meciId)) rosterByMatch.set(x.meciId, []); rosterByMatch.get(x.meciId).push(x); });
  datesBetween(lo,hi).forEach(d=>rosterLoadedDays.add(d));
}
function rosterOf(meciId, echipaId){
  const order = { 'căpitan':0, 'jucător':1, 'rezervă':2 };
  return (rosterByMatch.get(meciId)||[]).filter(r=>!echipaId || r.echipaId===echipaId)
    .sort((a,b)=>order[a.rol]-order[b.rol] || participantName(a.participantId).localeCompare(participantName(b.participantId),'ro'));
}
async function reloadMatchesForDay(day){
  if(ICON_PREVIEW_MODE) return;
  const { data, error } = await sb.from('meciuri').select('*').eq('data', day).order('nr');
  if(error) throw error;
  DB.meciuri = DB.meciuri.filter(m=>m.data!==day).concat((data||[]).map(mapMeci));
  rosterLoadedDays.delete(day);
  await loadRosters(day, day);
}
function currentRate(rol, situatie, day){
  return DB.tarife.filter(r=>r.rol===rol && r.situatie===situatie && r.valabilDeLa<=day).sort((a,b)=>b.valabilDeLa.localeCompare(a.valabilDeLa))[0] || null;
}

// stats come pre-aggregated from the database (no row limits)
let statsCache = {};
var loadStats = async function(from, to){
  const key = `${from||''}|${to||''}`;
  if(statsCache[key]) return statsCache[key];
  const [j, e] = await Promise.all([
    sb.rpc('statistici_jucatori', { p_de_la: from||null, p_pana_la: to||null }),
    sb.rpc('statistici_echipe', { p_de_la: from||null, p_pana_la: to||null }),
  ]);
  if(j.error || e.error) throw (j.error || e.error);
  const res = {
    jucatori: (j.data||[]).map(r=>({ participantId:r.participant_id, meciuri:r.meciuri, victorii:r.victorii, infrangeri:r.infrangeri,
      winRate:r.win_rate==null?null:Number(r.win_rate), plusMinus:r.plus_minus==null?null:Number(r.plus_minus),
      meciuriCapitan:r.meciuri_capitan, victoriiCapitan:r.victorii_capitan, meciuriRezerva:r.meciuri_rezerva,
      totalNet:Number(r.total_net), totalRetinere:Number(r.total_retinere), totalBrut:Number(r.total_brut), echipe:r.echipe })),
    echipe: (e.data||[]).map(r=>({ echipaId:r.echipa_id, meciuri:r.meciuri, victorii:r.victorii, infrangeri:r.infrangeri,
      winRate:r.win_rate==null?null:Number(r.win_rate), marcate:r.puncte_marcate, primite:r.puncte_primite,
      diferenta:r.diferenta_pe_meci==null?null:Number(r.diferenta_pe_meci) })),
  };
  statsCache[key] = res;
  return res;
};
function invalidateStats(){ statsCache = {}; }

/* ══════════════════════ ECHIPE ══════════════════════ */
let teamsStats = null;
async function openEchipe(){
  try { teamsStats = await loadStats(null, null); } catch(e){ console.error(e); }
  if(currentView==='echipe') render();
}
function renderEchipe(){
  const statById = Object.fromEntries((teamsStats?.echipe||[]).map(s=>[s.echipaId, s]));
  const teams = DB.echipe.slice().sort((a,b)=>(b.activ-a.activ) || (statById[b.id]?.winRate??-1)-(statById[a.id]?.winRate??-1) || a.nume.localeCompare(b.nume));
  const fara = DB.participanti.filter(p=>!p.echipaId && p.statut==='activ');
  return `
  <div class="view-head"><div class="view-title">${t('ec_title')}</div>${syncHeaderBtn()}</div>
  <div class="view-sub">${t('ec_sub')}</div>

  ${hasActiveShift() ? `<div class="add-form">
    <div class="form-title">${t('ec_addTitle')}</div>
    <div class="form-grid" style="grid-template-columns:2fr 0.6fr auto">
      <div class="field"><label>${t('ec_nume')}</label><input id="ecf-nume" placeholder="${t('ec_numePh')}"></div>
      <div class="field"><label>${t('ec_culoare')}</label><input id="ecf-culoare" type="color" value="#8E2236"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" onclick="addEchipa()">${t('ec_btnAdd')}</button></div>
    </div>
  </div>` : ''}

  ${syncStrip()}

  <div class="team-grid">
    ${teams.map(e=>{
      const s = statById[e.id];
      const players = teamPlayers(e.id);
      const form = teamForm(e.id).reverse();
      return `<section class="team-card ${e.activ?'':'inactive'} ${e.logoUrl?'has-logo':''}" style="--team:${esc(e.culoare||'var(--maroon)')}">
        ${e.logoUrl ? `<div class="team-card-logo" style="background-image:url('${esc(e.logoUrl)}')" aria-hidden="true"></div>` : ''}
        <div class="team-card-head">
          <div class="team-id">
            ${e.logoUrl ? `<img class="team-badge" src="${esc(e.logoUrl)}" alt="" loading="lazy">` : ''}
            <div><div class="team-name ${canEditTeams()?'clickable':''}" ${canEditTeams()?`onclick="openTeamEditor('${e.id}')"`:''}>${esc(e.nume)}</div>
            <div class="team-record">${s ? `${s.victorii}–${s.infrangeri} · ${pct(s.winRate)} · ${signed(s.diferenta)}/${t('ec_perMeci')}` : t('ec_faraMeciuri')}</div></div>
          </div>
          ${e.activ ? '' : `<span class="badge muted">${trEnum('inactiv')}</span>`}
        </div>
        ${form.length ? `<div class="team-form"><span class="team-form-label">${t('ec_forma')}</span>${form.map(f=>`<span class="form-pill ${f.won?'won':'lost'}" title="${esc(`${f.own}:${f.opp} · ${echipaName(f.oppId)} · ${ddmm(f.data)}`)}">${t(f.won?'ec_formaV':'ec_formaI')}</span>`).join('')}
          ${s ? `<span class="team-pts" title="${esc(t('ec_puncteTitlu'))}">${s.marcate}<span>:</span>${s.primite}</span>` : ''}</div>` : ''}
        <div class="mini-list">
          ${players.length ? players.map(p=>`<div class="mini-row clickable" onclick="openProfile('${p.id}')">
            <span>${p.nrEchipa?`<span class="team-nr">${p.nrEchipa}</span>`:''}<span class="mini-name">${esc(p.nume)} ${esc(p.prenume)}</span> ${p.rolEchipa==='căpitan'?`<span class="badge gold">${trEnum('căpitan')}</span>`:''}</span>
            <span class="td-muted">${p.rating!=null?`★ ${p.rating}`:''}</span></div>`).join('') : `<div class="mini-empty">${t('ec_faraJucatori')}</div>`}
        </div>
        ${canEditTeams() ? `<div class="team-card-actions">
          <button class="btn-primary btn-sm" onclick="openTeamEditor('${e.id}')">${t('ec_edit')}</button>
        </div>` : ''}
      </section>`;
    }).join('')}
  </div>

  ${fara.length ? `<div class="table-wrap"><div class="table-header"><div class="table-title">${t('ec_faraEchipa')} (${fara.length})</div></div>
    <div class="table-scroll"><table><tbody>${fara.sort((a,b)=>a.nume.localeCompare(b.nume,'ro')).map(p=>`<tr class="clickable" onclick="openProfile('${p.id}')"><td class="td-name">${esc(p.nume)} ${esc(p.prenume)}</td><td class="td-muted">${esc(p.club)||'—'}</td><td class="td-muted">${p.rating!=null?'★ '+p.rating:''}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
}
async function addEchipa(){
  const nume = document.getElementById('ecf-nume').value.trim();
  if(!nume) return;
  const culoare = document.getElementById('ecf-culoare').value || null;
  const { data, error } = await sb.from('echipe').insert({ nume, culoare }).select().single();
  if(error){ alert(error.code==='23505' ? t('ec_numeExista') : t('err_save')+' '+error.message); return; }
  DB.echipe.push({ id:data.id, nume:data.nume, culoare:data.culoare, activ:data.activ });
  await logAction(`A creat echipa ${nume}`);
  render();
}
/* ── Team editor: name, colour, status and the full roster in one dialog, saved in one go ── */
const TEAM_COLOR_PRESETS = ['#8E2236','#1F7A4C','#F5822A','#2B5BA8','#6E3FA3','#C9A227','#B23A48','#1E8C93','#4A4A4A','#D9D9D9'];
let teamEdit = null;
function canEditTeams(){ return hasActiveShift() || isAsistent(); }
function openTeamEditor(id){
  const e = echipa(id); if(!e || !canEditTeams()) return;
  const roster = DB.participanti.filter(p=>p.echipaId===id)
    .sort((a,b)=>(a.nrEchipa||9)-(b.nrEchipa||9) || (b.rating||0)-(a.rating||0) || a.nume.localeCompare(b.nume,'ro'))
    .map(p=>({ pid:p.id, nr:p.nrEchipa||'', rol:p.rolEchipa||'jucător' }));
  teamEdit = { id, nume:e.nume, culoare:e.culoare||'#8E2236', activ:e.activ, roster, removed:[] };
  renderTeamEditor();
  openModal('team-modal');
}
function teamEditField(key, value){ teamEdit[key] = value; if(key==='culoare') renderTeamEditor(); }
function teamEditPlayer(i, key, value){
  const row = teamEdit.roster[i]; if(!row) return;
  row[key] = key==='nr' ? (value===''?'':Number(value)) : value;
  renderTeamEditor();
}
function teamEditRemove(i){
  const [row] = teamEdit.roster.splice(i,1);
  if(row && participant(row.pid)?.echipaId===teamEdit.id) teamEdit.removed.push(row.pid);
  renderTeamEditor();
}
function teamEditAdd(){
  const pid = document.getElementById('te-add')?.value; if(!pid) return;
  if(teamEdit.roster.some(r=>r.pid===pid)) return;
  const p = participant(pid);
  const used = new Set(teamEdit.roster.map(r=>r.nr).filter(Boolean));
  const freeNr = [1,2,3,4].find(n=>!used.has(n)) || '';
  teamEdit.roster.push({ pid, nr:freeNr, rol: p?.rolEchipa==='arbitru' ? 'arbitru' : 'jucător' });
  teamEdit.removed = teamEdit.removed.filter(x=>x!==pid);
  renderTeamEditor();
}
function teamEditSetCaptainByRating(){
  const best = teamEdit.roster.filter(r=>r.rol!=='arbitru').sort((a,b)=>(participant(b.pid)?.rating||0)-(participant(a.pid)?.rating||0))[0];
  if(!best) return;
  teamEdit.roster.forEach(r=>{ if(r.rol==='căpitan') r.rol='jucător'; });
  best.rol = 'căpitan';
  renderTeamEditor();
}
function teamEditProblems(){
  const out = [];
  if(!teamEdit.nume.trim()) out.push(t('te_errNume'));
  // numbers may repeat within a team (the BSKT Cup sheet has several players on the same number)
  return out;
}
function renderTeamEditor(){
  const te = teamEdit; if(!te) return;
  document.getElementById('team-modal-title').textContent = te.nume || t('ec_edit');
  const inRoster = new Set(te.roster.map(r=>r.pid));
  const candidates = DB.participanti.filter(p=>p.statut==='activ' && !inRoster.has(p.id)).sort((a,b)=>a.nume.localeCompare(b.nume,'ro'));
  const problems = teamEditProblems();
  const players = te.roster.filter(r=>r.rol!=='arbitru');
  const st = teamsStats?.echipe?.find(s=>s.echipaId===te.id);
  const hasMatches = DB.meciuri.some(m=>m.echipaAId===te.id || m.echipaBId===te.id);
  document.getElementById('team-modal-body').innerHTML = `
    <div class="te-preview" style="--team:${esc(te.culoare)}">
      <div><div class="team-name">${esc(te.nume||'—')}</div>
      <div class="team-record">${st ? `${st.victorii}–${st.infrangeri} · ${pct(st.winRate)} · ${st.meciuri} ${plural(st.meciuri,'mt_meciuriSuffix')}` : t('ec_faraMeciuri')} · ${players.length} ${plural(players.length,'pa_countSuffix')}</div></div>
      ${te.activ ? '' : `<span class="badge muted">${trEnum('inactiv')}</span>`}
    </div>

    ${isAsistent() ? `<div class="view-sub" style="margin:14px 0 0">${t('as_teamNota')}</div>` : `<div class="form-grid" style="grid-template-columns:2fr 1fr;margin-top:16px">
      <div class="field"><label>${t('ec_nume')}</label><input value="${esc(te.nume)}" oninput="teamEdit.nume=this.value; document.getElementById('team-modal-title').textContent=this.value||'—'"></div>
      <div class="field"><label>${t('th_statut')}</label><select onchange="teamEditField('activ', this.value==='1')">
        <option value="1" ${te.activ?'selected':''}>${trEnum('activ')}</option><option value="0" ${!te.activ?'selected':''}>${trEnum('inactiv')}</option></select></div>
    </div>
    <div class="field" style="margin-top:12px"><label>${t('ec_culoare')}</label>
      <div class="te-colors">
        ${TEAM_COLOR_PRESETS.map(c=>`<button type="button" class="te-swatch ${c.toLowerCase()===String(te.culoare).toLowerCase()?'active':''}" style="background:${c}" title="${c}" onclick="teamEditField('culoare','${c}')"></button>`).join('')}
        <input type="color" value="${esc(te.culoare)}" onchange="teamEditField('culoare', this.value)" title="${esc(t('te_altaCuloare'))}">
      </div>
    </div>`}

    <div class="te-roster-head">
      <div class="form-title" style="margin:0">${t('te_lot')} (${te.roster.length})</div>
      <button type="button" class="btn-ghost btn-sm" onclick="teamEditSetCaptainByRating()">${t('te_capitanRating')}</button>
    </div>
    <div class="te-roster">
      ${te.roster.length ? te.roster.map((r,i)=>{ const p = participant(r.pid); const other = p?.echipaId && p.echipaId!==te.id;
        return `<div class="te-row ${r.rol==='căpitan'?'is-captain':''}">
          <div class="te-player"><span class="td-name" onclick="openProfile('${r.pid}')">${esc(participantName(r.pid))}</span>
            <span class="td-muted">${p?.rating!=null?`★ ${p.rating}`:''}${other?` · ${t('te_mutatDin')} ${esc(echipaName(p.echipaId))}`:''}</span></div>
          <select title="${esc(t('fi_nrEchipa'))}" onchange="teamEditPlayer(${i},'nr',this.value)"><option value="">${t('te_faraNr')}</option>${[1,2,3,4].map(n=>`<option value="${n}" ${r.nr===n?'selected':''}>#${n}</option>`).join('')}</select>
          <select onchange="teamEditPlayer(${i},'rol',this.value)">${TEAM_ROLES.map(x=>`<option value="${x}" ${r.rol===x?'selected':''}>${esc(trEnum(x))}</option>`).join('')}</select>
          <button type="button" class="btn-danger btn-sm" onclick="teamEditRemove(${i})" title="${esc(t('te_scoate'))}">${t('te_scoate')}</button>
        </div>`; }).join('') : `<div class="mini-empty">${t('ec_faraJucatori')}</div>`}
    </div>
    <div class="form-grid" style="grid-template-columns:1fr;margin-top:10px">
      <div class="field"><label>${t('te_adauga')}</label>${autocompleteField('te-add', candidates.map(p=>({ value:p.id, label:`${p.nume} ${p.prenume}${p.rating!=null?' · ★'+p.rating:''} · ${p.echipaId?echipaName(p.echipaId):t('ec_faraEchipa').toLowerCase()}` })), { placeholder:t('te_cautaJucator'), onSelect:'teamEditAdd' })}</div>
    </div>
    ${te.removed.length ? `<div class="view-sub" style="margin:10px 0 0">${t('te_vorFiScosi')}: ${te.removed.map(pid=>esc(participantName(pid))).join(', ')}</div>` : ''}
    <div class="view-sub" style="margin:10px 0 0">${t('te_notaNr')}</div>
    ${problems.length ? `<div class="te-problems">${problems.map(x=>`<div>${esc(x)}</div>`).join('')}</div>` : ''}

    <div class="profile-edit-actions">
      ${isFullAdmin() ? `<button type="button" class="btn-danger" style="margin-right:auto" onclick="deleteEchipa()" title="${esc(hasMatches?t('te_stergeBlocat'):'')}">${t('te_sterge')}</button>` : ''}
      <button type="button" class="btn-ghost" onclick="closeModal('team-modal')">${t('btn_cancel')}</button>
      <button type="button" class="btn-primary" ${problems.length?'disabled':''} onclick="saveTeamEditor()">${t('btn_save')}</button>
    </div>`;
}
async function saveTeamEditor(){
  const te = teamEdit; if(!te || teamEditProblems().length) return;
  if(isAsistent()) return saveTeamEditorAsistent();
  const e = echipa(te.id);
  const saveBtn = document.querySelector('#team-modal-body .profile-edit-actions .btn-primary');
  if(saveBtn){ saveBtn.disabled = true; saveBtn.textContent = t('btn_saving'); }
  const fail = msg => { alert(msg); if(saveBtn){ saveBtn.disabled = false; saveBtn.textContent = t('btn_save'); } };
  const { data:teamRow, error } = await sb.from('echipe').update({ nume:te.nume.trim(), culoare:te.culoare||null, activ:te.activ }).eq('id', te.id).select().single();
  if(error) return fail(error.code==='23505' ? t('ec_numeExista') : t('err_update')+' '+error.message);
  // players removed from the roster lose team, number and captaincy
  const updates = te.removed.map(pid=>({ pid, row:{ echipa_id:null, nr_echipa:null, rol_echipa: participant(pid)?.rolEchipa==='arbitru' ? 'arbitru' : 'jucător' } }));
  te.roster.forEach(r=>{
    const p = participant(r.pid);
    const row = { echipa_id:te.id, nr_echipa:r.nr||null, rol_echipa:r.rol };
    if(!p || p.echipaId!==row.echipa_id || (p.nrEchipa||null)!==row.nr_echipa || p.rolEchipa!==row.rol_echipa) updates.push({ pid:r.pid, row });
  });
  for(const u of updates){
    const { data, error:uErr } = await sb.from('participanti').update(u.row).eq('id', u.pid).select().single();
    if(uErr) return fail(t('err_update')+' '+participantName(u.pid)+': '+uErr.message);
    Object.assign(participant(u.pid), mapParticipant(data));
  }
  Object.assign(e, { nume:teamRow.nume, culoare:teamRow.culoare, activ:teamRow.activ });
  invalidateStats();
  await logAction(`A actualizat echipa ${teamRow.nume}: ${te.roster.length} jucători, ${updates.length} modificări de lot`);
  closeModal('team-modal');
  teamEdit = null;
  render();
  openEchipe();
}
async function deleteEchipa(){
  const te = teamEdit; if(!te || !isFullAdmin()) return;
  if(DB.meciuri.some(m=>m.echipaAId===te.id || m.echipaBId===te.id)){ alert(t('te_stergeBlocat')); return; }
  if(!confirm(t('te_confirmSterge')(te.nume))) return;
  // its players stay in the register without team, number or captaincy
  const { error:pErr } = await sb.from('participanti').update({ nr_echipa:null, rol_echipa:'jucător' }).eq('echipa_id', te.id).neq('rol_echipa','arbitru');
  if(pErr){ alert(t('err_update')+' '+pErr.message); return; }
  const { error:nErr } = await sb.from('participanti').update({ nr_echipa:null }).eq('echipa_id', te.id);
  if(nErr){ alert(t('err_update')+' '+nErr.message); return; }
  const { data, error } = await sb.from('echipe').delete().eq('id', te.id).select();
  if(error || !data?.length){ alert(t('err_delete')+' '+(error?.message||t('err_noPerm'))); return; }
  DB.echipe = DB.echipe.filter(x=>x.id!==te.id);
  DB.participanti.forEach(p=>{ if(p.echipaId===te.id){ p.echipaId = null; p.nrEchipa = null; if(p.rolEchipa!=='arbitru') p.rolEchipa = 'jucător'; } });  // FK is ON DELETE SET NULL
  await logAction(`A șters echipa ${te.nume}`);
  closeModal('team-modal'); teamEdit = null; render();
}

/* ══════════════════════ MECIURI ══════════════════════ */
let matchDay = null;
let matchDraft = null;
let matchScoreEditId = null;
let matchesLoading = false;
function matchDaysAvailable(){
  const days = new Set(DB.meciuri.map(m=>m.data));
  days.add(todayISO());
  return [...days].sort().reverse();
}
async function openMeciuri(){
  if(!matchDay){
    const today = todayISO();
    matchDay = DB.meciuri.some(m=>m.data===today) || hasActiveShift() ? today : (matchDaysAvailable().find(d=>DB.meciuri.some(m=>m.data===d)) || today);
  }
  matchesLoading = true; render();
  try { await Promise.all([reloadMatchesForDay(matchDay), loadLastSync(), loadSyncMeta(), recentLineups ? null : loadRecentLineups()]); } catch(e){ console.error(e); }
  matchesLoading = false;
  if(currentView==='meciuri') render();
}
async function setMatchDay(day){ matchDay = day; matchScoreEditId = null; await openMeciuri(); }
/* ── Match-day calendar: month grid, days with games marked, Monday-first ── */
let matchCalOpen = false;
let matchCalMonth = null;  // 'YYYY-MM' shown in the popover
const CAL_WEEKDAYS = { ro:['Lu','Ma','Mi','Jo','Vi','Sâ','Du'], ru:['Пн','Вт','Ср','Чт','Пт','Сб','Вс'] };
const CAL_WEEKDAYS_LONG = { ro:['Duminică','Luni','Marți','Miercuri','Joi','Vineri','Sâmbătă'], ru:['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'] };
function isoWeekday(iso){ return new Date(iso+'T00:00:00Z').getUTCDay(); }  // 0 = Sunday
function matchCountsByDay(){ const c = {}; DB.meciuri.forEach(m=>{ c[m.data] = (c[m.data]||0) + 1; }); return c; }
function renderMatchCalendar(day){
  const lang = LANG==='ru' ? 'ru' : 'ro';
  const counts = matchCountsByDay();
  const n = counts[day]||0;
  const playDays = Object.keys(counts).sort();
  const prevPlay = playDays.filter(d=>d<day).pop(), nextPlay = playDays.find(d=>d>day);
  const button = `<div class="mcal-bar">
      <button type="button" class="mcal-step" onclick="setMatchDay(addDays(matchDay,-1))" aria-label="${esc(t('cal_ziuaPrecedenta'))}">‹</button>
      <button type="button" class="mcal-trigger ${matchCalOpen?'open':''}" onclick="toggleMatchCal(event)">
        <span class="mcal-trigger-icon">${icon('calendar')}</span>
        <span class="mcal-trigger-text"><strong>${fmtDate(day)}</strong><span>${CAL_WEEKDAYS_LONG[lang][isoWeekday(day)]} · ${n ? `${n} ${plural(n,'mt_meciuriSuffix')}` : t('cal_faraMeciuri')}</span></span>
      </button>
      <button type="button" class="mcal-step" onclick="setMatchDay(addDays(matchDay,1))" aria-label="${esc(t('cal_ziuaUrmatoare'))}">›</button>
    </div>
    <div class="mcal-jumps">
      ${prevPlay ? `<button type="button" class="mcal-link" onclick="setMatchDay('${prevPlay}')">« ${t('cal_jocAnterior')} ${ddmm(prevPlay)}</button>` : '<span></span>'}
      ${nextPlay ? `<button type="button" class="mcal-link" onclick="setMatchDay('${nextPlay}')">${t('cal_jocUrmator')} ${ddmm(nextPlay)} »</button>` : ''}
    </div>`;
  if(!matchCalOpen) return `<div class="mcal" id="mcal">${button}</div>`;
  const month = matchCalMonth || day.slice(0,7);
  const first = month+'-01';
  const lead = (isoWeekday(first)+6)%7;               // empty cells before the 1st (Monday-first)
  const daysInMonth = Number(addDays(addMonths(first,1),-1).slice(8,10));
  const today = todayISO();
  const cells = [];
  for(let i=0;i<lead;i++) cells.push('<span class="mcal-cell empty"></span>');
  for(let d=1; d<=daysInMonth; d++){
    const iso = `${month}-${String(d).padStart(2,'0')}`;
    const c = counts[iso]||0;
    cells.push(`<button type="button" class="mcal-cell ${c?'has-games':''} ${iso===day?'selected':''} ${iso===today?'today':''}" onclick="pickMatchDay('${iso}')" title="${c?`${c} ${esc(plural(c,'mt_meciuriSuffix'))}`:''}">
      <span class="mcal-num">${d}</span>${c?`<span class="mcal-count">${c}</span>`:''}</button>`);
  }
  const monthGames = Object.entries(counts).filter(([d])=>d.startsWith(month)).reduce((s,[,v])=>s+v,0);
  return `<div class="mcal" id="mcal">${button}
    <div class="mcal-pop" onclick="event.stopPropagation()">
      <div class="mcal-head">
        <button type="button" class="mcal-nav" onclick="calShiftMonth(-1)">‹</button>
        <div class="mcal-title">${monthLabel(month)}<span>${monthGames ? `${monthGames} ${plural(monthGames,'mt_meciuriSuffix')}` : t('cal_faraMeciuri')}</span></div>
        <button type="button" class="mcal-nav" onclick="calShiftMonth(1)">›</button>
      </div>
      <div class="mcal-grid">${CAL_WEEKDAYS[lang].map(w=>`<span class="mcal-wd">${w}</span>`).join('')}${cells.join('')}</div>
      <div class="mcal-foot">
        <span class="mcal-legend"><i class="dot"></i>${t('cal_cuMeciuri')}</span>
        <button type="button" class="btn-ghost btn-sm" onclick="pickMatchDay(todayISO())">${t('cal_azi')}</button>
      </div>
    </div></div>`;
}
function toggleMatchCal(ev){
  if(ev) ev.stopPropagation();
  matchCalOpen = !matchCalOpen;
  matchCalMonth = (matchDay||todayISO()).slice(0,7);
  render();
}
function calShiftMonth(n){ matchCalMonth = addMonths((matchCalMonth||todayISO().slice(0,7))+'-01', n).slice(0,7); render(); }
function pickMatchDay(iso){ matchCalOpen = false; setMatchDay(iso); }
document.addEventListener('click', e=>{
  if(matchCalOpen && !e.target.closest('#mcal')){ matchCalOpen = false; if(currentView==='meciuri') render(); }
});
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && matchCalOpen){ matchCalOpen = false; render(); } });

function newMatchDraft(){
  const nextNr = DB.meciuri.reduce((m,x)=>Math.max(m, x.nr||0), 0) + 1;
  return { nr:nextNr, data:todayISO(), ora:'', teren:TERENURI[0]||'', a:'', b:'', sa:'', sb:'', slots:{ a:defaultSlots(''), b:defaultSlots('') } };
}
// Captain = highest rating in the line-up (BSKT rule); then two players and a reserve.
/* ── last line-up per team: recent matches with their rosters (games after midnight sort after the evening ones) ── */
let recentLineups = null;      // [{ key, data, opp, byTeam:{ echipaId: [{pid, rol}] } }] newest first
async function loadRecentLineups(){
  try {
    const rows = await selectPaged(()=>sb.from('meciuri').select('id,data,ora,echipa_a_id,echipa_b_id,meci_jucatori(echipa_id,participant_id,rol)')
      .gte('data', addDays(todayISO(), -90)).order('data', { ascending:false }).order('id'));
    recentLineups = rows.map(m=>{
      const byTeam = {};
      (m.meci_jucatori||[]).forEach(r=>{ (byTeam[r.echipa_id] ||= []).push({ pid:r.participant_id, rol:r.rol }); });
      return { key: matchSortKey(m.data, m.ora), data:m.data, a:m.echipa_a_id, b:m.echipa_b_id, byTeam };
    }).filter(m=>Object.keys(m.byTeam).length).sort((x,y)=>y.key.localeCompare(x.key));
  } catch(e){ console.error('recent line-ups', e); recentLineups = recentLineups || []; }
}
function matchSortKey(data, ora){ const o = ora ? String(ora).slice(0,5) : '99:99'; return `${data} ${o < '06:00' ? '1' : '0'}${o}`; }
// the team's most recent line-up before `beforeKey` (or ever), keeping only players still active
function lastLineup(echipaId, beforeKey){
  if(!echipaId || !recentLineups) return null;
  for(const m of recentLineups){
    if(beforeKey && m.key >= beforeKey) continue;
    const rows = (m.byTeam[echipaId]||[]).filter(r=>participant(r.pid)?.statut==='activ');
    if(rows.length >= 3) return { data:m.data, opp: m.a===echipaId ? m.b : m.a, rows };
  }
  return null;
}
function defaultSlots(echipaId, beforeKey){
  const last = lastLineup(echipaId, beforeKey);
  if(last){
    const order = { 'căpitan':0, 'jucător':1, 'rezervă':2 };
    const rows = last.rows.slice().sort((x,y)=>order[x.rol]-order[y.rol]).map(r=>({ pid:r.pid, rol:r.rol }));
    while(rows.length < 4) rows.push({ pid:'', rol:'rezervă' });
    return rows;
  }
  const ps = echipaId ? teamPlayers(echipaId).filter(p=>p.rolEchipa!=='arbitru').slice(0,4) : [];
  const byRating = ps.slice().sort((x,y)=>(y.rating||0)-(x.rating||0));
  // captain = highest rating, reserve = lowest rating of the four
  const ordered = byRating.map(p=>p.id);
  return [0,1,2,3].map(i=>({ pid: ordered[i]||'', rol: i===0?'căpitan':i===3?'rezervă':'jucător' }));
}
function draftField(key, value){ matchDraft[key] = value; }
function draftTeam(side, echipaId){ matchDraft[side] = echipaId; matchDraft.slots[side] = defaultSlots(echipaId); render(); }
function draftSlot(side, i, key, value){ matchDraft.slots[side][i][key] = value; }
function playerOptions(echipaId, selected){
  const team = echipaId ? teamPlayers(echipaId) : [];
  const others = DB.participanti.filter(p=>p.statut==='activ' && !team.includes(p)).sort((a,b)=>a.nume.localeCompare(b.nume,'ro'));
  const opt = p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(p.nume)} ${esc(p.prenume)}${p.rating!=null?' · ★'+p.rating:''}</option>`;
  // a player already in a saved line-up stays selectable even if now inactive or moved to another team
  const kept = selected && !team.some(p=>p.id===selected) && !others.some(p=>p.id===selected) ? participant(selected) : null;
  return `<option value="">—</option>${kept?opt(kept):''}${team.length?`<optgroup label="${esc(echipaName(echipaId))}">${team.map(opt).join('')}</optgroup>`:''}<optgroup label="${esc(t('mt_altiJucatori'))}">${others.map(opt).join('')}</optgroup>`;
}
function draftSideHtml(side){
  const d = matchDraft; const eid = d[side];
  return `<div class="match-side">
    <div class="field"><label>${t(side==='a'?'mt_echipaA':'mt_echipaB')}</label><select onchange="draftTeam('${side}', this.value)">
      <option value="">—</option>${echipeActive().map(e=>`<option value="${e.id}" ${e.id===eid?'selected':''}>${esc(e.nume)}</option>`).join('')}
    </select></div>
    ${eid ? (()=>{ const l = lastLineup(eid); return `<div class="lineup-source">${l ? t('mt_lotDinUltimul')(fmtDate(l.data), echipaName(l.opp)) : t('mt_lotDinEchipa')}</div>`; })() : ''}
    ${d.slots[side].map((s,i)=>`<div class="match-slot">
      <select onchange="draftSlot('${side}',${i},'pid',this.value)">${playerOptions(eid, s.pid)}</select>
      <select onchange="draftSlot('${side}',${i},'rol',this.value)">${MATCH_ROLES.map(r=>`<option value="${r}" ${s.rol===r?'selected':''}>${esc(trEnum(r))}</option>`).join('')}</select>
    </div>`).join('')}
    <div class="field"><label>${t('mt_scor')}</label><input type="number" min="0" value="${esc(d['s'+side])}" oninput="draftField('s${side}', this.value)"></div>
  </div>`;
}
/* ── results feed from 3x3.bsktcup.com (edge function results-sync, every 15 min during game hours) ── */
let lastSync = null;
let syncRunning = false;
async function loadLastSync(){
  if(ICON_PREVIEW_MODE){ lastSync = { rulat_la:new Date().toISOString(), ok:true }; return; }
  const { data } = await sb.from('sync_rezultate').select('rulat_la,ok,inserate,actualizate,eroare').order('id', {ascending:false}).limit(1);
  lastSync = data?.[0] || null;
}
function renderSyncBar(){
  const ok = lastSync?.ok;
  const when = lastSync ? `${t('mt_syncUltima')} ${fmtDateTime(lastSync.rulat_la)}` : t('mt_syncNiciodata');
  return `<div class="sync-bar">
    <span class="sync-dot ${lastSync ? (ok ? 'ok' : 'err') : ''}"></span>
    <span>${t('mt_syncSursa')} <a href="https://3x3.bsktcup.com/#results" target="_blank" rel="noopener">3x3.bsktcup.com</a> · ${esc(when)}${lastSync && !ok ? ` · <span style="color:var(--red)">${esc(lastSync.eroare||'')}</span>` : ''}</span>
    ${isFullAdmin() && !tabelActiv ? `<button class="btn-ghost btn-sm" ${syncRunning?'disabled':''} onclick="syncNow()">${t(syncRunning?'mt_syncRuleaza':'mt_syncAcum')}</button>` : ''}
  </div>`;
}
async function syncNow(){
  if(syncRunning) return;
  syncRunning = true; render();
  const { data, error } = await sb.functions.invoke('results-sync', { body:{} });
  syncRunning = false;
  if(error){ alert(t('mt_syncEroare')+' '+(error.message||'')); }
  else {
    const rows = await selectPaged(()=>sb.from('meciuri').select('*').order('data').order('nr')).catch(()=>null);
    if(rows) DB.meciuri = rows.map(mapMeci);
    invalidateStats();
    if(data && (data.inserate || data.actualizate)) await logAction(`A sincronizat rezultatele de pe 3x3.bsktcup.com: ${data.inserate} noi, ${data.actualizate} actualizate`);
  }
  await openMeciuri();
}
function renderMeciuri(){
  if(!matchDraft) matchDraft = newMatchDraft();
  const day = matchDay || todayISO();
  const matches = DB.meciuri.filter(m=>m.data===day).sort((a,b)=>matchSortKey(a).localeCompare(matchSortKey(b)));
  const dayNet = matches.reduce((s,m)=>s+rosterOf(m.id).reduce((x,r)=>x+(r.sumaNet||0),0),0);
  return `
  <div class="view-head"><div class="view-title">${t('mt_title')}</div>${syncHeaderBtn()}</div>
  <div class="view-sub">${t('mt_sub')}</div>

  <div class="add-form">
    <div class="form-grid" style="grid-template-columns:1fr auto">
      <div class="field"><label>${t('mt_ziua')}</label>${renderMatchCalendar(day)}</div>
      <div class="field" style="justify-content:flex-end">${canSeeMoney() ? `<div class="day-total">${t('mt_platiZi')}: <strong>${money(dayNet)} MDL</strong></div>` : ''}</div>
    </div>
    ${renderSyncBar()}
  </div>

  ${hasActiveShift() || isAsistent() ? `<div class="add-form">
    <div class="form-title">${t('mt_addTitle')}</div>
    ${isAsistent() ? `<div class="view-sub" style="margin:0 0 10px">${t('as_fereastra')(fmtDate(asistentWindowStart()), fmtDate(asistentWindowEnd()))}</div>` : ''}
    <div class="form-grid" style="grid-template-columns:0.5fr 0.8fr 0.6fr 1fr">
      <div class="field"><label>${t('mt_nr')}</label><input type="number" min="1" value="${esc(matchDraft.nr)}" oninput="draftField('nr', this.value)"></div>
      <div class="field"><label>${t('th_data')}</label><input type="date" ${isAsistent()?`min="${asistentWindowStart()}" max="${asistentWindowEnd()}"`:''} value="${esc(matchDraft.data)}" oninput="draftField('data', this.value)"></div>
      <div class="field"><label>${t('mt_ora')}</label><input type="time" value="${esc(matchDraft.ora)}" oninput="draftField('ora', this.value)"></div>
      <div class="field"><label>${t('mt_teren')}</label><select onchange="draftField('teren', this.value)">${TERENURI.map(x=>`<option ${x===matchDraft.teren?'selected':''}>${esc(x)}</option>`).join('')}</select></div>
    </div>
    <div class="match-draft">${draftSideHtml('a')}<div class="match-vs">VS</div>${draftSideHtml('b')}</div>
    <div class="view-sub" style="margin:10px 0 12px">${t('mt_regulaCapitan')}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn-ghost" onclick="matchDraft=newMatchDraft(); render();">${t('btn_cancel')}</button>
      <button class="btn-primary" onclick="saveMatch()">${t('mt_btnSave')}</button>
    </div>
  </div>` : ''}

  ${matchesLoading ? '' : noRosterBanner(scoredWithoutRoster(matches))}
  ${!matchesLoading && (isFullAdmin() || (isAsistent() && inAsistentWindow(day))) && matches.some(m=>sideEmpty(m, m.echipaAId) || sideEmpty(m, m.echipaBId)) ? `<div class="dl-cta"><button class="btn-primary" onclick="openDayLineups('${day}')">${t('dl_btn')}</button><span class="td-muted">${t('dl_btnSub')}</span></div>` : ''}
  ${syncStrip()}
  ${matchesLoading ? `<div class="alert-empty">${t('st_loading2')}</div>` : matches.length ? `<div class="match-list">${matches.map((m,i)=>(isAfterMidnight(m.ora) && !isAfterMidnight(matches[i-1]?.ora) ? `<div class="night-divider"><span>${t('mt_dupaMiezulNoptii')} · ${fmtDate(addDays(day,1))}</span></div>` : '') + renderMatchCard(m)).join('')}</div>` : `<div class="alert-empty">${t('mt_none')}</div>`}`;
}
function scoredWithoutRoster(matches){ return matches.filter(m=>winnerOf(m) && !(rosterByMatch.get(m.id)||[]).length); }
function noRosterBanner(list, textKey='mt_faraLotAvert'){
  if(!list.length) return '';
  const days = [...new Set(list.map(m=>m.data))].sort();
  return `<div class="te-problems roster-warning">${t(textKey)(list.length)}
    <span class="roster-warning-days">${days.map(d=>`<button type="button" class="btn-ghost btn-sm" onclick="goToMatchDay('${d}')">${fmtDate(d)} · ${list.filter(m=>m.data===d).length}</button>`).join('')}</span></div>`;
}
async function goToMatchDay(d){ matchDay = d; matchCalOpen = false; navigate('meciuri'); }
/* ── Line-ups of the day: one line-up per team, applied to every match of that team on the day
   that has no players yet (synced matches arrive from the site with scores only). Never overwrites
   a side that already has players; single matches can still be corrected in the match editor. ── */
let dayLineups = null;   // { day, teams: { echipaId: { slots:[{pid,rol}], matches:[id] } }, order:[echipaId] }
function sideEmpty(m, eid){ return !(rosterByMatch.get(m.id)||[]).some(r=>r.echipaId===eid); }
function openDayLineups(day){
  if(!isFullAdmin() && !(isAsistent() && inAsistentWindow(day))) return;
  const matches = DB.meciuri.filter(m=>m.data===day).sort((a,b)=>matchSortKey(a.data,a.ora).localeCompare(matchSortKey(b.data,b.ora)));
  const teams = {}, order = [];
  matches.forEach(m=>[m.echipaAId, m.echipaBId].forEach(eid=>{
    if(!sideEmpty(m, eid)) return;
    if(!teams[eid]){ const key = matchSortKey(m.data, m.ora); teams[eid] = { slots: defaultSlots(eid, key), beforeKey: key, matches: [] }; order.push(eid); }
    teams[eid].matches.push(m.id);
  }));
  dayLineups = { day, teams, order };
  document.getElementById('record-modal-title').textContent = `${t('dl_title')} · ${fmtDate(day)}`;
  renderDayLineups();
  openModal('record-modal');
}
function dlSlot(eid, i, key, value){ dayLineups.teams[eid].slots[i][key] = value; }
function dlAddSlot(eid){ dayLineups.teams[eid].slots.push({ pid:'', rol:'jucător' }); renderDayLineups(); }
function dlSkip(eid){ dayLineups.teams[eid].skip = !dayLineups.teams[eid].skip; renderDayLineups(); }
function renderDayLineups(){
  const d = dayLineups;
  const body = document.getElementById('record-modal-body');
  if(!d.order.length){ body.innerHTML = `<div class="alert-empty">${t('dl_nimic')}</div>`; return; }
  const matchLabel = id => { const m = DB.meciuri.find(x=>x.id===id); const score = m.scorA!=null && m.scorB!=null ? ` <strong>${m.scorA}:${m.scorB}</strong>` : ''; return `<strong>${esc(matchTimeLabel(m.data, m.ora)||'—')}</strong> · ${esc(echipaName(m.echipaAId))} – ${esc(echipaName(m.echipaBId))}${score}`; };
  body.innerHTML = `
    <div class="view-sub" style="margin:0 0 14px">${t('dl_sub')}</div>
    <div class="dl-grid">${d.order.map(eid=>{ const tm = d.teams[eid]; const last = lastLineup(eid, tm.beforeKey);
      return `<section class="dl-team ${tm.skip?'skipped':''}" style="--team:${esc(echipa(eid)?.culoare||'var(--border)')}">
        <div class="dl-team-head"><div class="team-name">${teamDot(eid)}${esc(echipaName(eid))}</div>
          <label class="check-line" style="padding:0"><input type="checkbox" ${tm.skip?'':'checked'} onchange="dlSkip('${eid}')"> ${t('dl_aplica')}</label></div>
        <div class="lineup-source">${last ? t('mt_lotDinUltimul')(fmtDate(last.data), echipaName(last.opp)) : t('mt_lotDinEchipa')}</div>
        ${tm.slots.map((sl,i)=>`<div class="match-slot">
          <select ${tm.skip?'disabled':''} onchange="dlSlot('${eid}',${i},'pid',this.value)">${playerOptions(eid, sl.pid)}</select>
          <select ${tm.skip?'disabled':''} onchange="dlSlot('${eid}',${i},'rol',this.value)">${MATCH_ROLES.map(r=>`<option value="${r}" ${sl.rol===r?'selected':''}>${esc(trEnum(r))}</option>`).join('')}</select>
        </div>`).join('')}
        ${tm.skip ? '' : `<button type="button" class="btn-ghost btn-sm" onclick="dlAddSlot('${eid}')">+ ${t('mt_addSlot')}</button>`}
        <div class="dl-matches"><div class="pay-detail-title">${t('dl_seAplicaLa')(tm.matches.length)}</div>${tm.matches.map(id=>`<div class="td-muted">${matchLabel(id)}</div>`).join('')}</div>
      </section>`; }).join('')}</div>
    <div class="profile-edit-actions">
      <button type="button" class="btn-ghost" onclick="closeModal('record-modal')">${t('btn_cancel')}</button>
      <button type="button" class="btn-primary" onclick="saveDayLineups()">${t('dl_salveaza')}</button>
    </div>`;
}
async function saveDayLineups(){
  const d = dayLineups; if(!d) return;
  const active = d.order.filter(eid=>!d.teams[eid].skip);
  if(!active.length){ closeModal('record-modal'); return; }
  // validate each team's line-up
  for(const eid of active){
    const picked = d.teams[eid].slots.filter(s=>s.pid);
    const name = echipaName(eid);
    if(picked.length < 3){ alert(`${name}: ${t('mt_needPlayers')}`); return; }
    if(picked.filter(s=>s.rol==='căpitan').length > 1){ alert(`${name}: ${t('mt_unCapitan')}`); return; }
    if(new Set(picked.map(s=>s.pid)).size !== picked.length){ alert(`${name}: ${t('mt_dublura')}`); return; }
  }
  // a player can't be on both sides of the same match
  const rows = [];
  for(const eid of active){
    const picked = d.teams[eid].slots.filter(s=>s.pid);
    for(const mid of d.teams[eid].matches){
      const m = DB.meciuri.find(x=>x.id===mid); const opp = m.echipaAId===eid ? m.echipaBId : m.echipaAId;
      const oppIds = new Set([...(rosterByMatch.get(mid)||[]).filter(r=>r.echipaId===opp).map(r=>r.participantId),
        ...(active.includes(opp) && d.teams[opp].matches.includes(mid) ? d.teams[opp].slots.filter(s=>s.pid).map(s=>s.pid) : [])]);
      const clash = picked.find(s=>oppIds.has(s.pid));
      if(clash){ alert(t('dl_conflict')(participantName(clash.pid), matchTimeLabel(m.data, m.ora), echipaName(m.echipaAId), echipaName(m.echipaBId))); return; }
      if(!sideEmpty(m, eid)) continue;   // filled meanwhile: never overwrite
      picked.forEach(s=>rows.push({ meci_id:mid, echipa_id:eid, participant_id:s.pid, rol:s.rol }));
    }
  }
  if(isAsistent()) return saveDayLineupsAsistent(d, active, rows);
  const btn = document.querySelector('#record-modal-body .profile-edit-actions .btn-primary');
  if(btn){ btn.disabled = true; btn.textContent = t('btn_saving'); }
  const { error } = await sb.from('meci_jucatori').insert(rows);
  if(error){ alert(t('err_save')+' '+error.message); if(btn){ btn.disabled = false; btn.textContent = t('dl_salveaza'); } return; }
  const nMatches = new Set(rows.map(r=>r.meci_id)).size;
  invalidateStats();
  await reloadMatchesForDay(d.day);
  loadRecentLineups();
  await logAction(`A completat loturile zilei ${fmtDate(d.day)}: ${active.length} echipe, ${nMatches} meciuri`);
  closeModal('record-modal'); dayLineups = null;
  render();
}
function renderMatchCard(m){
  const w = winnerOf(m);
  const side = (eid, score)=>`<div class="match-team ${w===eid?'won':w?'lost':''}" style="--team:${esc(echipa(eid)?.culoare||'var(--border)')}">
      <div class="match-team-name">${teamDot(eid)}${esc(echipaName(eid))}</div>
      <div class="match-score">${score==null?'–':score}</div>
      <div class="match-roster">${rosterOf(m.id, eid).map(r=>`<div class="match-roster-row">
        <span class="td-name" onclick="openProfile('${r.participantId}')">${esc(participantName(r.participantId))}</span>
        <span>${r.rol!=='jucător'?`<span class="badge ${r.rol==='căpitan'?'gold':'muted'}">${esc(trEnum(r.rol))}</span>`:''}</span>
        ${canSeeMoney() ? `<span class="td-gold">${r.sumaNet==null?'—':money(r.sumaNet)}</span>` : '<span></span>'}</div>`).join('') || `<div class="mini-empty">${t('mt_faraLot')}</div>`}</div>
    </div>`;
  const editing = matchScoreEditId===m.id;
  const fromSheet = m.sursa==='tabel', fromSite = !fromSheet && !!m.idExtern;
  const manual = (fromSheet || fromSite) && matchManualOverride(m);   // edited by hand: syncs leave it alone
  return `<article class="match-card ${m.scorA==null?'pending':''}">
    <div class="match-meta">${m.nr!=null?`<span class="match-nr">#${m.nr}</span>`:''}<span class="match-time">${esc(matchTimeLabel(m.data, m.ora))||'—'}</span>${isAfterMidnight(m.ora)?`<span class="badge night" title="${esc(t('mt_dupaMiezulNoptiiTitlu')(fmtDate(m.data), fmtDate(addDays(m.data,1))))}">${t('mt_dupaMiezulNoptii')}</span>`:''}${m.teren?`<span>${esc(m.teren)}</span>`:''}${m.prelungiri?`<span class="badge amber">OT</span>`:''}
      ${fromSheet ? `<span class="badge site" title="${esc(t('tb_dinTabelTitlu'))}">${t('tb_badgeTabel')}</span>` : fromSite ? `<span class="badge site" title="${esc(t('mt_dinSiteTitlu'))}">3x3.bsktcup.com</span>` : ''}
      ${(fromSheet || fromSite) && m.scorA==null ? `<span class="badge muted">${t('mt_programat')}</span>` : ''}
      ${manual ? `<span class="badge amber" title="${esc(t('tb_manualTitlu'))}">${t('tb_badgeManual')}</span>${isFullAdmin() && fromSheet && !isWeekLocked(m.data) ? ` <button class="btn-ghost btn-sm" onclick="acceptSheetForMatch('${m.id}')">${t('tb_preia')}</button>` : ''}` : ''}
      ${isWeekLocked(m.data) ? `<span class="badge gold" title="${esc(t('pl_blocataTitlu'))}">${t('pl_blocata')}</span>` : ''}
      ${canEditMatch(m) ? `<span class="match-actions">${editing ? `
        <input id="ms-a-${m.id}" type="number" min="0" value="${m.scorA??''}" class="score-input"> : <input id="ms-b-${m.id}" type="number" min="0" value="${m.scorB??''}" class="score-input">
        <label class="ot-check"><input id="ms-ot-${m.id}" type="checkbox" ${m.prelungiri?'checked':''}> OT</label>
        <button class="btn-primary btn-sm" onclick="saveMatchScore('${m.id}')">${t('btn_save')}</button>
        <button class="btn-ghost btn-sm" onclick="matchScoreEditId=null; render();">${t('btn_cancel')}</button>` : `
        <button class="btn-ghost btn-sm" onclick="matchScoreEditId='${m.id}'; render();">${t('mt_scorBtn')}</button>
        ${isFullAdmin() ? `<button class="btn-ghost btn-sm" onclick="openMatchEditor('${m.id}')">${t('ed_edit')}</button>` : ''}
        <button class="btn-danger btn-sm" onclick="deleteMatch('${m.id}')">${t('btn_delete')}</button>`}</span>` : isAsistent() && canOpenMatchEditor(m) ? `<span class="match-actions"><button class="btn-ghost btn-sm" onclick="openMatchEditor('${m.id}')">${t('ed_edit')}</button></span>` : ''}
    </div>
    <div class="match-body">${side(m.echipaAId, m.scorA)}<div class="match-vs">VS</div>${side(m.echipaBId, m.scorB)}</div>
    ${winnerOf(m) && !(rosterByMatch.get(m.id)||[]).length ? `<div class="match-noroster">${t('mt_faraLotCard')}${canOpenMatchEditor(m) ? ` <button class="btn-primary btn-sm" onclick="openMatchEditor('${m.id}')">${t('mt_completeazaLot')}</button>` : ''}</div>` : ''}
  </article>`;
}
async function saveMatch(){
  const d = matchDraft;
  if(!d.a || !d.b || d.a===d.b){ alert(t('mt_needTeams')); return; }
  const rows = [];
  for(const side of ['a','b']){
    const picked = d.slots[side].filter(s=>s.pid);
    if(picked.length < 3){ alert(t('mt_needPlayers')); return; }
    if(picked.filter(s=>s.rol==='căpitan').length > 1){ alert(t('mt_unCapitan')); return; }
    picked.forEach(s=>rows.push({ echipa_id:d[side], participant_id:s.pid, rol:s.rol }));
  }
  const ids = rows.map(r=>r.participant_id);
  if(new Set(ids).size !== ids.length){ alert(t('mt_dublura')); return; }
  const sa = d.sa==='' ? null : Number(d.sa), sbv = d.sb==='' ? null : Number(d.sb);
  if(sa!=null && sbv!=null && sa===sbv){ alert(t('mt_egal')); return; }
  if(isAsistent()) return saveMatchAsistent(d, rows, sa, sbv);
  const payload = { nr: d.nr ? Number(d.nr) : null, data:d.data||todayISO(), ora:d.ora||null, teren:d.teren||null,
    echipa_a_id:d.a, echipa_b_id:d.b, scor_a:sa, scor_b:sbv, sesiune_schimb_id: isFullAdmin() ? null : currentShift.id };
  const { data:m, error } = await sb.from('meciuri').insert(payload).select().single();
  if(error){ alert(t('err_save')+' '+error.message); return; }
  const { error:rErr } = await sb.from('meci_jucatori').insert(rows.map(r=>({ ...r, meci_id:m.id })));
  if(rErr){ await sb.from('meciuri').delete().eq('id', m.id); alert(t('err_save')+' '+rErr.message); return; }
  invalidateStats();
  matchDay = m.data;
  await reloadMatchesForDay(m.data);
  await logAction(`A înregistrat meciul #${m.nr??''} ${echipaName(d.a)} – ${echipaName(d.b)}${sa!=null?` (${sa}:${sbv})`:''}`);
  loadRecentLineups();
  matchDraft = newMatchDraft();
  matchDraft.data = m.data; matchDraft.teren = payload.teren || matchDraft.teren;
  render();
}
/* ── admin match editor: details, teams, score and both line-ups (pay is re-frozen by the DB trigger on save) ── */
let matchEdit = null;
function openMatchEditor(id){
  const m = DB.meciuri.find(x=>x.id===id);
  if(m && isWeekLocked(m.data)){ alert(t('pl_blocataTitlu')); return; }
  if(!m || !canOpenMatchEditor(m)) return;
  const slotsFor = eid => {
    const rows = rosterOf(m.id, eid).map(r=>({ pid:r.participantId, rol:r.rol }));
    if(!rows.length) return defaultSlots(eid, matchSortKey(m.data, m.ora));
    while(rows.length < 4) rows.push({ pid:'', rol: rows.length===3 ? 'rezervă' : 'jucător' });
    return rows;
  };
  matchEdit = { id, locked: isAsistent() && !!m.idExtern, nr: m.nr ?? '', data: m.data, ora: m.ora || '', teren: m.teren || '', prelungiri: !!m.prelungiri,
    arbitru: m.arbitru || '', observatii: m.observatii || '', a: m.echipaAId, b: m.echipaBId,
    sa: m.scorA ?? '', sb: m.scorB ?? '', slots: { a: slotsFor(m.echipaAId), b: slotsFor(m.echipaBId) },
    original: (rosterByMatch.get(m.id)||[]).map(r=>({ echipa_id:r.echipaId, participant_id:r.participantId, rol:r.rol })) };
  document.getElementById('record-modal-title').textContent = `${t('mt_editTitle')}${m.nr!=null?' #'+m.nr:''} · ${echipaName(m.echipaAId)} – ${echipaName(m.echipaBId)}`;
  renderMatchEditor();
  openModal('record-modal');
}
function meField(key, value){ matchEdit[key] = value; }
function meTeam(side, eid){ matchEdit[side] = eid; matchEdit.slots[side] = defaultSlots(eid, matchSortKey(matchEdit.data, matchEdit.ora)); renderMatchEditor(); }
function meSlot(side, i, key, value){ matchEdit.slots[side][i][key] = value; }
function meAddSlot(side){ matchEdit.slots[side].push({ pid:'', rol:'jucător' }); renderMatchEditor(); }
function renderMatchEditor(){
  const e = matchEdit, L = e.locked ? 'disabled' : '';
  const side = s => `<div class="match-side">
    <div class="field"><label>${t(s==='a'?'mt_echipaA':'mt_echipaB')}</label><select ${L} onchange="meTeam('${s}', this.value)">
      ${withCurrent(echipeActive().map(x=>({value:x.id,label:x.nume})), e[s]).map(o=>`<option value="${o.value}" ${o.value===e[s]?'selected':''}>${esc(o.value===e[s]?echipaName(o.value):o.label)}</option>`).join('')}
    </select></div>
    ${e.slots[s].map((sl,i)=>`<div class="match-slot">
      <select onchange="meSlot('${s}',${i},'pid',this.value)">${playerOptions(e[s], sl.pid)}</select>
      <select onchange="meSlot('${s}',${i},'rol',this.value)">${MATCH_ROLES.map(r=>`<option value="${r}" ${sl.rol===r?'selected':''}>${esc(trEnum(r))}</option>`).join('')}</select>
    </div>`).join('')}
    <button type="button" class="btn-ghost btn-sm" onclick="meAddSlot('${s}')">+ ${t('mt_addSlot')}</button>
    <div class="field"><label>${t('mt_scor')}</label><input type="number" min="0" ${L} value="${esc(e['s'+s])}" oninput="meField('s${s}', this.value)"></div>
  </div>`;
  document.getElementById('record-modal-body').innerHTML = `
    ${e.locked ? `<div class="alert-note">${t('mt_siteLocked')}</div>` : ''}
    <div class="record-grid">
      <div class="field"><label>${t('mt_nr')}</label><input type="number" min="1" value="${esc(e.nr)}" oninput="meField('nr', this.value)"></div>
      <div class="field"><label>${t('th_data')}</label><input type="date" ${L} ${isAsistent()?`min="${asistentWindowStart()}" max="${asistentWindowEnd()}"`:''} value="${esc(e.data)}" oninput="meField('data', this.value)"></div>
      <div class="field"><label>${t('mt_ora')}</label><input type="time" ${L} value="${esc(e.ora)}" oninput="meField('ora', this.value)"></div>
      <div class="field"><label>${t('mt_teren')}</label><select onchange="meField('teren', this.value)">${withCurrent(optsOf(['', ...TERENURI], x=>x||'—'), e.teren).map(o=>`<option value="${esc(o.value)}" ${o.value===e.teren?'selected':''}>${esc(o.label)}</option>`).join('')}</select></div>
      <div class="field"><label>${t('ar_th_arbitru')}</label><select onchange="meField('arbitru', this.value)">${withCurrent(optsOf(['', ...arbitriActivi().map(a=>`${a.nume} ${a.prenume}`)], x=>x||'—'), e.arbitru).map(o=>`<option value="${esc(o.value)}" ${o.value===e.arbitru?'selected':''}>${esc(o.label)}</option>`).join('')}</select></div>
      <div class="field"><label>${t('mt_prelungiri')}</label><label class="check-box"><input type="checkbox" ${e.prelungiri?'checked':''} onchange="meField('prelungiri', this.checked)"><span>${t('mt_prelungiriDa')}</span></label></div>
      <div class="field wide"><label>${t('da2_observatii')}</label><textarea rows="2" oninput="meField('observatii', this.value)">${esc(e.observatii)}</textarea></div>
    </div>
    <div class="form-title" style="margin-top:16px">${t('mt_loturi')}</div>
    <div class="view-sub" style="margin:0 0 10px">${t('mt_rosterHint')}</div>
    <div class="match-draft">${side('a')}<div class="match-vs">VS</div>${side('b')}</div>
    <div class="profile-edit-actions">
      <button type="button" class="btn-ghost" onclick="closeModal('record-modal')">${t('btn_cancel')}</button>
      <button type="button" class="btn-primary" onclick="saveMatchEditor()">${t('btn_save')}</button>
    </div>`;
}
async function saveMatchEditor(){
  const e = matchEdit; if(!e) return;
  const m = DB.meciuri.find(x=>x.id===e.id); if(!m) return;
  if(!e.a || !e.b || e.a===e.b){ alert(t('mt_needTeams')); return; }
  if(!isCompleteDate(e.data)){ alert(t('ed_badDate')(t('th_data'))); return; }
  const sa = e.sa==='' ? null : Number(e.sa), sbv = e.sb==='' ? null : Number(e.sb);
  if((sa==null) !== (sbv==null) || (sa!=null && (sa<0 || sbv<0))){ alert(t('ed_badNumber')(t('mt_scor'))); return; }
  if(sa!=null && sa===sbv){ alert(t('mt_egal')); return; }
  const rows = [];
  for(const s of ['a','b']){
    const picked = e.slots[s].filter(x=>x.pid);
    if(picked.filter(x=>x.rol==='căpitan').length > 1){ alert(t('mt_unCapitan')); return; }
    picked.forEach(x=>rows.push({ echipa_id:e[s], participant_id:x.pid, rol:x.rol }));
  }
  const counts = ['a','b'].map(s=>rows.filter(r=>r.echipa_id===e[s]).length);
  if(rows.length && counts.some(c=>c<3)){ alert(t('mt_needPlayers')); return; }
  if(new Set(rows.map(r=>r.participant_id)).size !== rows.length){ alert(t('mt_dublura')); return; }

  const key = r=>`${r.echipa_id}|${r.participant_id}|${r.rol}`;
  const rosterChanged = rows.map(key).sort().join() !== e.original.map(key).sort().join();
  const teamsChanged = e.a!==m.echipaAId || e.b!==m.echipaBId;
  const payload = { nr: e.nr==='' ? null : Number(e.nr), teren: e.teren || null, prelungiri: !!e.prelungiri,
    arbitru: e.arbitru || null, observatii: String(e.observatii||'').trim() || null };
  if(!e.locked) Object.assign(payload, { data:e.data, ora:e.ora||null, echipa_a_id:e.a, echipa_b_id:e.b, scor_a:sa, scor_b:sbv });
  if(isAsistent()) return saveMatchEditorAsistent(e, m, payload, rows, rosterChanged || teamsChanged);

  const btn = document.querySelector('#record-modal-body .profile-edit-actions .btn-primary');
  if(btn){ btn.disabled = true; btn.textContent = t('btn_saving'); }
  const done = () => { if(btn){ btn.disabled = false; btn.textContent = t('btn_save'); } };
  // the pay trigger rejects players whose team is not in the match, so the line-up is cleared before teams change
  const replaceRoster = rosterChanged || teamsChanged;
  if(replaceRoster && e.original.length){
    const { error } = await sb.from('meci_jucatori').delete().eq('meci_id', m.id);
    if(error){ done(); alert(t('err_update')+' '+error.message); return; }
  }
  const restore = async () => { if(replaceRoster && e.original.length) await sb.from('meci_jucatori').insert(e.original.map(r=>({ ...r, meci_id:m.id }))); };
  const { data:upd, error:uErr } = await sb.from('meciuri').update(payload).eq('id', m.id).select();
  if(uErr || !upd?.length){ await restore(); done(); alert(t('err_update')+' '+(uErr?.message || t('ed_noPermission'))); return; }
  if(replaceRoster && rows.length){
    const { error:iErr } = await sb.from('meci_jucatori').insert(rows.map(r=>({ ...r, meci_id:m.id })));
    if(iErr){ await restore(); done(); alert(t('err_update')+' '+iErr.message); return; }
  }
  done();
  invalidateStats();
  const oldDay = m.data, newDay = upd[0].data;
  await reloadMatchesForDay(oldDay);
  if(newDay!==oldDay){ await reloadMatchesForDay(newDay); matchDay = newDay; }
  await logAction(`A corectat meciul ${m.nr!=null?'#'+m.nr+' ':''}${echipaName(e.a)} – ${echipaName(e.b)}${replaceRoster?' (loturi modificate)':''}`);
  if(replaceRoster) loadRecentLineups();
  closeModal('record-modal');
  matchEdit = null;
  render();
}
async function saveMatchScore(id){
  const m = DB.meciuri.find(x=>x.id===id); if(!m || !canEditMatch(m)) return;
  const a = document.getElementById(`ms-a-${id}`).value, b = document.getElementById(`ms-b-${id}`).value;
  const scor_a = a==='' ? null : Number(a), scor_b = b==='' ? null : Number(b);
  if(scor_a!=null && scor_b!=null && scor_a===scor_b){ alert(t('mt_egal')); return; }
  const prelungiri = document.getElementById(`ms-ot-${id}`).checked;
  const { data, error } = await sb.from('meciuri').update({ scor_a, scor_b, prelungiri }).eq('id', id).select();
  if(error || !data?.length){ alert(t('err_update')+' '+(error?.message||'')); return; }
  matchScoreEditId = null;
  invalidateStats();
  await reloadMatchesForDay(m.data);
  await logAction(`A înregistrat scorul meciului #${m.nr??''}: ${scor_a??'–'}:${scor_b??'–'}`);
  render();
}
async function deleteMatch(id){
  const m = DB.meciuri.find(x=>x.id===id); if(!m) return;
  if(!confirm(t('mt_confirmDelete')(m.nr))) return;
  const { data, error } = await sb.from('meciuri').delete().eq('id', id).select();
  if(error || !data?.length){ alert(t('err_delete')+' '+(error?.message||'')); return; }
  DB.meciuri = DB.meciuri.filter(x=>x.id!==id);
  rosterByMatch.delete(id);
  invalidateStats();
  await logAction(`A șters meciul #${m.nr??''} ${echipaName(m.echipaAId)} – ${echipaName(m.echipaBId)}`);
  render();
}

/* ── Helper (asistent) edits: every save shows a review with the exact changes and the effect on pay,
   then goes through a checked database function that logs a before/after snapshot (undoable by an admin). ── */
let reviewAction = null;
function showReview(title, html, onConfirm){
  reviewAction = onConfirm;
  document.getElementById('review-modal-title').textContent = title;
  document.getElementById('review-modal-body').innerHTML = `${html}
    ${isAsistent() ? `<div class="view-sub" style="margin:14px 0 0">${t('as_reviewNota')}</div>` : ''}
    <div class="profile-edit-actions">
      <button type="button" class="btn-ghost" onclick="closeReview()">${t('as_inapoi')}</button>
      <button type="button" class="btn-primary" id="review-confirm" onclick="confirmReview()">${t('as_confirma')}</button>
    </div>`;
  openModal('review-modal');
}
function closeReview(){ reviewAction = null; closeModal('review-modal'); }
async function confirmReview(){
  const fn = reviewAction; if(!fn) return;
  const btn = document.getElementById('review-confirm');
  if(btn){ btn.disabled = true; btn.textContent = t('btn_saving'); }
  let ok = false;
  try { ok = await fn(); } catch(e){ alert(t('err_save')+' '+(e.message||e)); }
  if(ok){ closeReview(); return; }
  if(btn){ btn.disabled = false; btn.textContent = t('as_confirma'); }
}
function grossFor(day, won, rol){ const r = currentRate(rol, won?'victorie':'înfrângere', day); return r ? r.net/(1-r.retinerePct/100) : 0; }
function payMap(match, rows){
  const w = match.sa!=null && match.sb!=null && match.sa!==match.sb ? (match.sa>match.sb ? match.a : match.b) : null;
  const map = new Map();
  rows.forEach(r=>{
    const net = w ? (currentRate(r.rol, r.echipa_id===w?'victorie':'înfrângere', match.data)?.net || 0) : 0;
    map.set(r.participant_id, { rol:r.rol, eid:r.echipa_id, gross: !w ? 0 : isFreelancer(r.participant_id) ? grossFor(match.data, r.echipa_id===w, r.rol) : net });
  });
  return { scored: !!w, map };
}
function signedMoney(v){ const r = Math.round(v*100)/100; return `${r>0?'+':r<0?'−':''}${money(Math.abs(r))}`; }
// before: { match:{data,ora,a,b,sa,sb}, rows } or null for a new match; after: same shape
function matchChanges(before, after){
  const lines = []; let total = 0;
  const label = x=>`${fmtDate(x.data)}${x.ora?' '+x.ora:''} · ${echipaName(x.a)} – ${echipaName(x.b)}${x.sa!=null&&x.sb!=null?` ${x.sa}:${x.sb}`:''}`;
  if(before){
    const b = before.match, a = after.match;
    if(b.data!==a.data || (b.ora||'')!==(a.ora||'')) lines.push({ text:`${t('as_chData')}: ${fmtDate(b.data)} ${b.ora||''} → ${fmtDate(a.data)} ${a.ora||''}` });
    if(b.a!==a.a || b.b!==a.b) lines.push({ text:`${t('as_chEchipe')}: ${echipaName(b.a)} – ${echipaName(b.b)} → ${echipaName(a.a)} – ${echipaName(a.b)}` });
    if(b.sa!==a.sa || b.sb!==a.sb) lines.push({ text:`${t('mt_scor')}: ${b.sa??'–'}:${b.sb??'–'} → ${a.sa??'–'}:${a.sb??'–'}` });
  }
  const pb = before ? payMap(before.match, before.rows) : { map:new Map() }, pa = payMap(after.match, after.rows);
  const ids = [...new Set([...pb.map.keys(), ...pa.map.keys()])].sort((x,y)=>participantName(x).localeCompare(participantName(y),'ro'));
  ids.forEach(id=>{
    const b = pb.map.get(id), a = pa.map.get(id), delta = (a?.gross||0) - (b?.gross||0);
    let text = null;
    if(!b && a) text = `+ ${participantName(id)} (${trEnum(a.rol)}, ${echipaName(a.eid)})`;
    else if(b && !a) text = `− ${participantName(id)} (${trEnum(b.rol)}, ${echipaName(b.eid)})`;
    else if(b.rol!==a.rol || b.eid!==a.eid) text = `${participantName(id)}: ${trEnum(b.rol)} → ${trEnum(a.rol)}${b.eid!==a.eid?` (${echipaName(a.eid)})`:''}`;
    else if(Math.abs(delta) > 0.004) text = participantName(id);
    if(text){ lines.push({ text, delta }); total += delta; }
  });
  return { title:label(after.match), isNew:!before, lines, total, scored:pa.scored };
}
function changesHtml(list){
  const total = list.reduce((x,c)=>x+c.total,0);
  return `<div class="review-list">${list.map(c=>`<section class="review-item">
      <div class="review-head">${c.isNew?`<span class="badge green">${t('as_nou')}</span> `:''}${esc(c.title)}</div>
      ${c.lines.length ? c.lines.map(l=>`<div class="review-line"><span>${esc(l.text)}</span>${l.delta!=null && c.scored ? `<span class="${l.delta>0?'c-green':l.delta<0?'c-red':'td-muted'}">${signedMoney(l.delta)} MDL</span>` : '<span></span>'}</div>`).join('') : `<div class="td-muted">${t('as_faraSchimbari')}</div>`}
      ${c.scored ? '' : `<div class="td-muted review-note">${t('as_faraScorPlata')}</div>`}
    </section>`).join('')}</div>
    <div class="review-total"><span>${t('as_impactPlata')}</span><strong class="${total>0?'c-green':total<0?'c-red':''}">${signedMoney(total)} MDL</strong></div>`;
}
function changesSummary(c){
  const parts = c.lines.map(l=>l.text).slice(0, 12);
  return `${c.isNew?'Meci nou ':'Meci '}${c.title}: ${parts.join('; ')}${c.lines.length>12?'; …':''}${c.scored?` · Δ brut ${signedMoney(c.total)} MDL`:''}`;
}
async function afterMatchSave(days){
  invalidateStats();
  for(const d of [...new Set(days)]) await reloadMatchesForDay(d);
  loadRecentLineups();
  asLog = null;
}
function saveMatchAsistent(d, rows, sa, sbv){
  const day = d.data || todayISO();
  if(!inAsistentWindow(day)){ alert(t('as_inafaraFerestrei')(fmtDate(asistentWindowStart()), fmtDate(asistentWindowEnd()))); return; }
  const after = { match:{ data:day, ora:d.ora||'', a:d.a, b:d.b, sa, sb:sbv }, rows };
  const c = matchChanges(null, after);
  showReview(t('as_reviewMeciNou'), changesHtml([c]), async ()=>{
    const p_meci = { nr:d.nr||'', data:day, ora:d.ora||'', teren:d.teren||'', echipa_a_id:d.a, echipa_b_id:d.b, scor_a:sa??'', scor_b:sbv??'' };
    const { error } = await sb.rpc('asistent_salveaza_meci', { p_meci_id:null, p_meci, p_lot:rows, p_grup:null, p_rezumat:changesSummary(c) });
    if(error){ alert(t('err_save')+' '+error.message); return false; }
    await afterMatchSave([day]);
    matchDay = day; matchDraft = newMatchDraft(); matchDraft.data = day; matchDraft.teren = d.teren || matchDraft.teren;
    render(); return true;
  });
}
function saveMatchEditorAsistent(e, m, payload, rows, replaceRoster){
  const before = { match:{ data:m.data, ora:m.ora, a:m.echipaAId, b:m.echipaBId, sa:m.scorA, sb:m.scorB }, rows:e.original };
  const after = { match: e.locked ? before.match : { data:payload.data, ora:payload.ora||'', a:payload.echipa_a_id, b:payload.echipa_b_id, sa:payload.scor_a, sb:payload.scor_b },
                  rows: replaceRoster ? rows : e.original };
  if(!e.locked && !inAsistentWindow(after.match.data)){ alert(t('as_inafaraFerestrei')(fmtDate(asistentWindowStart()), fmtDate(asistentWindowEnd()))); return; }
  const c = matchChanges(before, after);
  const detail = ['nr','teren','arbitru','observatii','prelungiri'].filter(k=>String(payload[k]??'')!==String((k==='prelungiri'?!!m.prelungiri:m[k])??'')).length;
  if(!c.lines.length && !detail){ closeModal('record-modal'); matchEdit = null; return; }
  if(detail) c.lines.unshift({ text:t('as_chDetalii') });
  showReview(t('as_reviewMeci'), changesHtml([c]), async ()=>{
    const p_meci = { nr:payload.nr??'', teren:payload.teren||'', arbitru:payload.arbitru||'', observatii:payload.observatii||'', prelungiri:!!payload.prelungiri };
    if(!e.locked) Object.assign(p_meci, { data:payload.data, ora:payload.ora||'', echipa_a_id:payload.echipa_a_id, echipa_b_id:payload.echipa_b_id, scor_a:payload.scor_a??'', scor_b:payload.scor_b??'' });
    const { error } = await sb.rpc('asistent_salveaza_meci', { p_meci_id:m.id, p_meci, p_lot: replaceRoster ? rows : null, p_grup:null, p_rezumat:changesSummary(c) });
    if(error){ alert(t('err_update')+' '+error.message); return false; }
    await afterMatchSave([m.data, after.match.data]);
    if(after.match.data!==m.data) matchDay = after.match.data;
    closeModal('record-modal'); matchEdit = null; render(); return true;
  });
}
function saveDayLineupsAsistent(d, active, rows){
  const byMatch = new Map();
  rows.forEach(r=>{ if(!byMatch.has(r.meci_id)) byMatch.set(r.meci_id, []); byMatch.get(r.meci_id).push({ echipa_id:r.echipa_id, participant_id:r.participant_id, rol:r.rol }); });
  const changes = [...byMatch.entries()].map(([mid, added])=>{
    const m = DB.meciuri.find(x=>x.id===mid);
    const existing = (rosterByMatch.get(mid)||[]).map(r=>({ echipa_id:r.echipaId, participant_id:r.participantId, rol:r.rol }));
    const match = { data:m.data, ora:m.ora, a:m.echipaAId, b:m.echipaBId, sa:m.scorA, sb:m.scorB };
    return { mid, lot:[...existing, ...added], c: matchChanges({ match, rows:existing }, { match, rows:[...existing, ...added] }) };
  });
  if(!changes.length){ closeModal('record-modal'); return; }
  showReview(`${t('dl_title')} · ${fmtDate(d.day)}`, changesHtml(changes.map(x=>x.c)), async ()=>{
    const grup = crypto.randomUUID();
    for(const x of changes){
      const { error } = await sb.rpc('asistent_salveaza_meci', { p_meci_id:x.mid, p_meci:null, p_lot:x.lot, p_grup:grup, p_rezumat:changesSummary(x.c) });
      if(error){ alert(t('err_save')+' '+error.message); await afterMatchSave([d.day]); render(); return false; }
    }
    await afterMatchSave([d.day]);
    closeModal('record-modal'); dayLineups = null; render(); return true;
  });
}
function saveTeamEditorAsistent(){
  const te = teamEdit, lines = [];
  te.roster.forEach(r=>{
    const p = participant(r.pid); if(!p) return;
    const nr = r.nr||null;
    if(p.echipaId!==te.id) lines.push(`+ ${participantName(r.pid)}${p.echipaId?` (${t('te_mutatDin')} ${echipaName(p.echipaId)})`:''} · ${trEnum(r.rol)}${nr?' #'+nr:''}`);
    else if((p.nrEchipa||null)!==nr || p.rolEchipa!==r.rol) lines.push(`${participantName(r.pid)}: ${trEnum(p.rolEchipa)}${p.nrEchipa?' #'+p.nrEchipa:''} → ${trEnum(r.rol)}${nr?' #'+nr:''}`);
  });
  te.removed.forEach(pid=>lines.push(`− ${participantName(pid)}`));
  if(!lines.length){ closeModal('team-modal'); teamEdit = null; return; }
  const html = `<div class="review-list"><section class="review-item"><div class="review-head">${esc(te.nume)}</div>${lines.map(l=>`<div class="review-line"><span>${esc(l)}</span><span></span></div>`).join('')}</section></div>
    <div class="view-sub" style="margin:10px 0 0">${t('as_teamPlataNota')}</div>`;
  showReview(t('as_reviewEchipa'), html, async ()=>{
    const lot = te.roster.map(r=>({ participant_id:r.pid, nr_echipa:r.nr||'', rol_echipa:r.rol }));
    const { error } = await sb.rpc('asistent_salveaza_echipa', { p_echipa_id:te.id, p_lot:lot, p_scosi:te.removed, p_grup:null, p_rezumat:`Echipa ${te.nume}: ${lines.join('; ')}` });
    if(error){ alert(t('err_update')+' '+error.message); return false; }
    te.removed.forEach(pid=>{ const p = participant(pid); if(p && p.echipaId===te.id) Object.assign(p, { echipaId:null, nrEchipa:null, rolEchipa: p.rolEchipa==='arbitru'?'arbitru':'jucător' }); });
    te.roster.forEach(r=>{ const p = participant(r.pid); if(p) Object.assign(p, { echipaId:te.id, nrEchipa:r.nr||null, rolEchipa:r.rol }); });
    invalidateStats(); asLog = null;
    closeModal('team-modal'); teamEdit = null; render(); openEchipe(); return true;
  });
}
function saveProfileAsistent(){
  const p = participant(currentProfileId); if(!p) return;
  const statut = document.getElementById('ap-statut').value, aviz = document.getElementById('ap-aviz').value || null, dulap = document.getElementById('ap-dulap').value.trim() || null;
  const freelancer = document.getElementById('ap-freelancer').value==='1';
  if(aviz && (aviz > todayISO() || aviz < addDays(todayISO(),-366))){ alert(t('as_avizInvalid')); return; }
  const lines = [];
  if(statut!==p.statut) lines.push(`${t('th_statut')}: ${trEnum(p.statut)} → ${trEnum(statut)}`);
  if((aviz||null)!==(p.dataAvizMedical||null)) lines.push(`${t('pa_aviz')}: ${p.dataAvizMedical?fmtDate(p.dataAvizMedical):'—'} → ${aviz?fmtDate(aviz):'—'}`);
  if((dulap||null)!==(p.nrDulap||null)) lines.push(`${t('pa_dulap')}: ${p.nrDulap||'—'} → ${dulap||'—'}`);
  if(freelancer!==(p.freelancer!==false)) lines.push(`${t('fl_label')}: ${t(p.freelancer!==false?'fl_da':'fl_nu')} → ${t(freelancer?'fl_da':'fl_nu')}`);
  if(!lines.length){ renderProfile(false); return; }
  const html = `<div class="review-list"><section class="review-item"><div class="review-head">${esc(participantName(p.id))}</div>${lines.map(l=>`<div class="review-line"><span>${esc(l)}</span><span></span></div>`).join('')}</section></div>`;
  showReview(t('as_reviewJucator'), html, async ()=>{
    const { error } = await sb.rpc('asistent_salveaza_jucator', { p_id:p.id, p_statut:statut, p_aviz:aviz, p_dulap:dulap||'', p_freelancer:freelancer, p_rezumat:`${participantName(p.id)}: ${lines.join('; ')}` });
    if(error){ alert(t('err_update')+' '+error.message); return false; }
    Object.assign(p, { statut, dataAvizMedical:aviz, nrDulap:dulap, freelancer });
    asLog = null; renderProfile(false); render(); return true;
  });
}
/* change log: the admin sees every helper save (and can undo it); the helper sees their own */
let asLog = null;   // { loading, groups:[{grup, creatLa, autor, items:[...], anulat}] }
async function loadAsistentLog(){
  if(asLog) return;
  asLog = { loading:true, groups:[] };
  if(ICON_PREVIEW_MODE){ asLog = { loading:false, groups:[] }; return; }
  const { data, error } = await sb.from('modificari_asistent').select('id,grup,creat_la,autor_id,tip,actiune,rezumat,anulat_la').gte('creat_la', addDays(todayISO(),-21)).order('id', {ascending:false}).limit(300);
  const groups = new Map();
  (data||[]).forEach(r=>{ if(!groups.has(r.grup)) groups.set(r.grup, { grup:r.grup, creatLa:r.creat_la, autor:r.autor_id, items:[], anulat:true }); const g = groups.get(r.grup); g.items.push(r); if(!r.anulat_la) g.anulat = false; });
  asLog = { loading:false, error:error?.message, groups:[...groups.values()] };
  if(currentView==='dashboard') render();
}
function renderAsistentLog(){
  loadAsistentLog();
  const admin = isFullAdmin();
  const groups = asLog?.groups || [];
  if(admin && !groups.length && !asLog?.loading) return '';
  const who = id=>adminName(DB.administratori.find(a=>a.id===id));
  return `<div class="alerts-panel">
    <div class="alerts-panel-head">${t(admin?'as_logTitluAdmin':'as_logTitlu')}${asLog?.loading?` <span class="td-muted">· ${t('as_seIncarca')}</span>`:''}</div>
    ${groups.length ? groups.slice(0,40).map(g=>`<div class="alert-row as-log-row ${g.anulat?'undone':''}">
      <span class="td-muted as-log-when">${fmtDateTime(g.creatLa)}${admin?`<br>${esc(who(g.autor))}`:''}</span>
      <span class="alert-text">${g.items.map(i=>`<div>${esc(i.rezumat||'')}</div>`).join('')}</span>
      ${g.anulat ? `<span class="badge muted">${t('as_anulat')}</span>` : admin ? `<button class="btn-ghost btn-sm" onclick="undoAsistentGroup('${g.grup}')">${t('as_anuleaza')}</button>` : ''}
    </div>`).join('') : `<div class="alert-empty">${t('as_logGol')}</div>`}
  </div>`;
}
async function undoAsistentGroup(grup){
  const g = asLog?.groups.find(x=>x.grup===grup); if(!g) return;
  if(!confirm(t('as_confirmAnulare')(g.items.length))) return;
  const { error } = await sb.rpc('anuleaza_modificari_asistent', { p_grup:grup });
  if(error){ alert(error.message); return; }
  await fetchAll();
  asLog = null; render();
}

/* ══════════════════════ PLĂȚI ══════════════════════ */
let payState = null;
let payLoading = false;
// Plăți opens on the current calendar month
function defaultPayRange(){
  const from = todayISO().slice(0,8) + '01';
  return { from, to:addDays(addMonths(from,1),-1) };
}
// "Octombrie 2026" when the period is exactly one calendar month, otherwise "06.10 – 12.10.2026"
function payPeriodLabel(from, to){
  const m = Number(from.slice(5,7)), y = from.slice(0,4);
  if(from.slice(8)==='01' && to === addDays(addMonths(from,1),-1)) return `${MONTH_NAMES[LANG==='ru'?'ru':'ro'][m-1]} ${y}`;
  return from.slice(0,4)===to.slice(0,4) ? `${ddmm(from)} – ${fmtDate(to)}` : `${fmtDate(from)} – ${fmtDate(to)}`;
}
async function openPlati(){
  if(!payState) payState = defaultPayRange();
  payLoading = true; renderPlatiBodyOnly();
  try { await Promise.all([loadRosters(payState.from, payState.to), loadSyncMeta()]); } catch(e){ console.error(e); alert(t('err_load')+' '+e.message); }
  payLoading = false;
  if(currentView==='plati') renderPlatiBodyOnly();
}
// Redraw everything except the period bar, so a date being typed is never replaced mid-edit.
function renderPlatiBodyOnly(){
  const body = document.getElementById('pay-body');
  if(currentView!=='plati' || !body){ render(); return; }
  body.innerHTML = renderPlatiBody();
  enhanceIcons(body);
  fitPayDetails();
}
// While a date is typed by hand the browser reports partial years (0002, 0020, 0202…) as complete
// dates; re-rendering on those steals the field. Only act on a real, complete date.
function isCompleteDate(v){ return /^\d{4}-\d{2}-\d{2}$/.test(v||'') && v >= '2000-01-01' && v <= '2100-12-31'; }
async function setPayRange(from, to){
  if(!isCompleteDate(from) || !isCompleteDate(to)) return;
  if(from > to) [from, to] = [to, from];
  payState = { from, to };
  const lbl = document.querySelector('.pay-period-label'); if(lbl) lbl.textContent = payPeriodLabel(from, to);
  const wl = document.querySelector('.week-locks'); if(wl) wl.outerHTML = renderWeekLocks(from, to);
  const ins = document.querySelectorAll('.pay-period-dates input');
  ins.forEach((el,i)=>{ const v = i===0 ? from : to; if(el.value!==v && document.activeElement!==el) el.value = v; });
  await openPlati();
}
function payPreset(kind){
  const today = todayISO();
  if(kind==='week'){ const f = weekStart(today); return setPayRange(f, addDays(f,6)); }
  if(kind==='lastWeek'){ const f = addDays(weekStart(today),-7); return setPayRange(f, addDays(f,6)); }
  if(kind==='month'){ const f = today.slice(0,8)+'01'; return setPayRange(f, addDays(addMonths(f,1),-1)); }
}
// deductions charged to the player in the same period: laundry, damages, paid trainings
function deductionsFor(participantId, from, to){
  const inR = d => d && d>=from && d<=to;
  const spal = DB.spalatorie.filter(r=>r.participantId===participantId && inR(r.data)).reduce((s,r)=>s+Number(r.suma||0),0);
  const daune = DB.daune.filter(r=>r.participantId===participantId && inR(r.data)).reduce((s,r)=>s+Number(r.valoareEstimata||0),0);
  const antr = DB.treninguri.filter(r=>r.participantId===participantId && inR(r.data)).reduce((s,r)=>s+Number(r.sumaJucator||0),0);
  return { spal, daune, antr, total: spal+daune+antr };
}
function payRows(){
  const { from, to } = payState;
  const matches = DB.meciuri.filter(m=>m.data>=from && m.data<=to);
  const days = [...new Set(matches.map(m=>m.data))].sort();
  const byPlayer = new Map();
  matches.forEach(m=>{
    const w = winnerOf(m);
    rosterOf(m.id).forEach(r=>{
      let e = byPlayer.get(r.participantId);
      if(!e){ e = { participantId:r.participantId, echipe:new Set(), echipaIds:new Set(), meciuri:0, v:0, i:0, cap:0, rez:0, jucator:0, net:0, ret:0, brut:0, coefSum:0, coefN:0, perDay:{}, items:[] }; byPlayer.set(r.participantId, e); }
      e.echipe.add(echipaName(r.echipaId)); e.echipaIds.add(r.echipaId);
      if(w){ e.meciuri++; if(w===r.echipaId) e.v++; else e.i++; }
      if(r.rol==='căpitan') e.cap++;
      if(r.rol==='rezervă') e.rez++;
      if(r.rol==='jucător') e.jucator++;
      // "Coef. vs bază" as in the rate sheet: amount ÷ base (player, loss) on that match date
      const base = currentRate('jucător','înfrângere', m.data)?.net;
      if(r.sumaNet!=null && base){ e.coefSum += r.sumaNet / base; e.coefN++; }
      e.net += r.sumaNet||0; e.ret += r.retinere||0; e.brut += r.sumaBruta||0;
      e.perDay[m.data] = (e.perDay[m.data]||0) + (r.sumaNet||0);
      e.items.push({ m, r, won: w ? w===r.echipaId : null });
    });
  });
  const rows = [...byPlayer.values()].map(e=>{
    const ded = deductionsFor(e.participantId, from, to);
    e.items.sort((a,b)=>(a.m.data+String(a.m.nr||0).padStart(6,'0')).localeCompare(b.m.data+String(b.m.nr||0).padStart(6,'0')));
    // freelancer: the company pays the GROSS ("Brut necesar") and the player pays the 15% tax;
    // not a freelancer: the company pays the net (brut = net, no withholding on our side)
    const fl = isFreelancer(e.participantId);
    const brut = fl ? e.brut : e.net, ret = fl ? e.ret : 0;
    return { ...e, brut, ret, brutFreelancer: e.brut, freelancer: fl, echipe:[...e.echipe].join(', '), echipaIds:[...e.echipaIds], nume:participantName(e.participantId), ded,
      coef: e.coefN ? e.coefSum / e.coefN : null, dePlata: brut - ded.total };
  }).sort((a,b)=>a.nume.localeCompare(b.nume,'ro'));
  return { rows, days, matches };
}
function payRoleText(r){
  const parts = [];
  if(r.cap) parts.push(`${trEnum('căpitan')} ×${r.cap}`);
  if(r.jucator) parts.push(`${trEnum('jucător')} ×${r.jucator}`);
  if(r.rez) parts.push(`${trEnum('rezervă')} ×${r.rez}`);
  return parts.join(' · ');
}
function payObservation(r){
  const o = [];
  if(r.cap) o.push(t('pl_obsCapitan'));
  if(r.rez) o.push(t('pl_obsRezerva'));
  if(!r.cap && !r.rez) o.push(t('pl_obsBaza'));
  if(r.ded.total){
    const d = [];
    if(r.ded.spal) d.push(`${t('nav_spalatorie')} ${money(r.ded.spal)}`);
    if(r.ded.daune) d.push(`${t('nav_daune')} ${money(r.ded.daune)}`);
    o.push(`${t('pl_obsRetinut')}: ${d.join(', ')}`);
  }
  return o.join('; ');
}
function coefText(c){ return c==null ? '—' : c.toLocaleString('ro-RO',{minimumFractionDigits:2, maximumFractionDigits:2})+'x'; }
// view options of the Plăți page (kept while navigating)
let payView = { tab:'jucatori', q:'', team:'', sort:'nume', days:false, open:new Set() };
function payFilteredRows(rows){
  const q = searchNorm(payView.q);
  let out = rows.filter(r=>(!q || searchNorm(`${r.nume} ${r.echipe}`).includes(q)) && (!payView.team || r.echipaIds.includes(payView.team)));
  const sorters = {
    nume:(a,b)=>a.nume.localeCompare(b.nume,'ro'),
    net:(a,b)=>b.net-a.net, brut:(a,b)=>b.brut-a.brut, dePlata:(a,b)=>b.dePlata-a.dePlata, meciuri:(a,b)=>b.meciuri-a.meciuri || a.nume.localeCompare(b.nume,'ro'),
    ded:(a,b)=>b.ded.total-a.ded.total || a.nume.localeCompare(b.nume,'ro'),
    echipa:(a,b)=>a.echipe.localeCompare(b.echipe) || a.nume.localeCompare(b.nume,'ro'),
  };
  return out.sort(sorters[payView.sort]||sorters.nume);
}
function setPayTab(tab){ payView.tab = tab; renderPlatiBodyOnly(); }
function payToggle(pid){ payView.open.has(pid) ? payView.open.delete(pid) : payView.open.add(pid); refreshPayTable(); }
function paySet(key, value){ payView[key] = value; if(key==='q') refreshPayTable(); else renderPlatiBodyOnly(); }
function refreshPayTable(){
  const box = document.getElementById('pay-table-box');
  if(box){ box.innerHTML = payTableHtml(); enhanceIcons(box); fitPayDetails(); } else render();
}
// the details panel stays inside the visible part of the (horizontally scrollable) table
function fitPayDetails(){
  const sc = document.querySelector('#pay-table-box .pay-scroll');
  if(sc) sc.style.setProperty('--pay-visible-w', (sc.clientWidth - 32) + 'px');
}
window.addEventListener('resize', ()=>{ if(currentView==='plati') fitPayDetails(); });
function payDetailHtml(r, colspan){
  const d = r.ded;
  return `<tr class="pay-detail"><td colspan="${colspan}">
    <div class="pay-detail-grid" style="width:var(--pay-visible-w, auto)">
      <div>
        <div class="pay-detail-title">${t('pl_detMeciuri')} (${r.items.length})</div>
        <div class="pay-matches">${r.items.map(({m,r:x,won})=>{ const opp = x.echipaId===m.echipaAId ? m.echipaBId : m.echipaAId;
          const my = x.echipaId===m.echipaAId ? m.scorA : m.scorB, their = x.echipaId===m.echipaAId ? m.scorB : m.scorA;
          return `<div class="pay-match ${won===true?'won':won===false?'lost':''}">
            <span class="td-muted">${ddmm(m.data)} · #${m.nr??'—'}</span>
            <span>${esc(echipaName(x.echipaId))} <b>${my??'–'}:${their??'–'}</b> ${esc(echipaName(opp))}</span>
            <span>${x.rol!=='jucător'?`<span class="badge ${x.rol==='căpitan'?'gold':'muted'}">${esc(trEnum(x.rol))}</span>`:''}</span>
            <span class="num td-gold">${x.sumaNet==null?'—':money(x.sumaNet)}</span></div>`; }).join('')}</div>
      </div>
      <div>
        <div class="pay-detail-title">${t('pl_detCalcul')}</div>
        <div class="pay-calc">
          <div><span>${t('fl_label')}</span><b>${freelancerBadge(r.freelancer)}</b></div>
          <div><span>${t('pl_th_netJucator')}</span><b>${money(r.net)}</b></div>
          ${r.freelancer ? `<div><span>÷ 0,85 = ${t('pl_th_brutNecesar')}</span><b>${money(r.brut)}</b></div>
          <div><span>− ${t('pl_th_retinere15')}</span><b>${money(r.ret)}</b></div>
          <div class="sum"><span>= ${t('pl_th_netRamas')}</span><b>${money(r.net)}</b></div>` : `<div class="td-muted" style="font-size:12px">${t('fl_nuCalc')}</div>`}
          <div><span>${t('pl_th_brutNecesar')}</span><b>${money(r.brut)}</b></div>
          <div><span>− ${t('nav_spalatorie')}</span><b>${d.spal?money(d.spal):'0'}</b></div>
          <div><span>− ${t('nav_daune')}</span><b>${d.daune?money(d.daune):'0'}</b></div>
          <div class="sum total"><span>= ${t('pl_th_dePlataBrut')}</span><b>${money(r.dePlata)} MDL</b></div>
        </div>
        <div class="td-muted" style="font-size:12px;margin-top:8px">${t('pl_th_coef')} ${coefText(r.coef)} · ${t('pl_th_observatie')}: ${esc(payObservation(r))}</div>
        <button type="button" class="btn-profile" onclick="openProfile('${r.participantId}')"><span class="btn-profile-icon">${icon('participants')}</span><span>${t('pl_deschideProfil')}</span><span class="btn-profile-arrow">→</span></button>
      </div>
    </div>
  </td></tr>`;
}
function payTableHtml(){
  const { rows:all, days, matches } = payRows();
  const rows = payFilteredRows(all);
  const showDays = payView.days;
  // with day columns on, Coef., Net rămas (= Net / jucător) and Observație make room for a full week;
  // the observation is still shown in the player's detail panel
  const cols = 15 + (showDays ? days.length - 3 : 0);
  const tot = rows.reduce((s,r)=>({ v:s.v+r.v, i:s.i+r.i, net:s.net+r.net, ret:s.ret+r.ret, brut:s.brut+r.brut, ded:s.ded+r.ded.total, dp:s.dp+r.dePlata }), { v:0, i:0, net:0, ret:0, brut:0, ded:0, dp:0 });
  const filtered = rows.length !== all.length;
  return `<div class="table-scroll pay-scroll"><table class="pay-table">
    <thead><tr><th class="pay-caret-col"></th><th>${t('pl_th_jucator')}<span class="pay-th-sub">${t('pl_th_echipa')}</span></th>
      <th class="num">${t('pl_th_victorii')}</th><th class="num">${t('pl_th_infrangeri')}</th><th>${t('pl_th_rol')}</th><th>${t('fl_label')}</th>
      ${showDays ? days.map(d=>`<th class="num">${ddmm(d)}</th>`).join('') : ''}
      <th class="num">${t('pl_th2_net')}</th>${showDays ? '' : `<th class="num pay-opt">${t('pl_th_coef')}</th>`}<th class="num pay-gross-col">${t('pl_th2_brut')}</th>
      <th class="num">${t('pl_th2_ret')}</th>${showDays ? '' : `<th class="num pay-opt">${t('pl_th2_netRamas')}</th>`}
      <th class="num">${t('pl_th_ded')}</th><th class="num pay-gross-col pay-gross-end">${t('pl_th_dePlataBrut')}</th>${showDays ? '' : `<th class="pay-obs">${t('pl_th_observatie')}</th>`}</tr></thead>
    <tbody>${payLoading ? `<tr><td class="td-empty" colspan="${cols}">${t('st_loading2')}</td></tr>` : rows.length ? rows.map(r=>{ const open = payView.open.has(r.participantId);
      return `<tr class="pay-row ${open?'open':''}" onclick="payToggle('${r.participantId}')">
        <td class="pay-caret-col"><span class="pay-caret">›</span></td>
        <td class="pay-who"><span class="td-name">${esc(r.nume)}</span>${playerTeamsHtml(r.participantId, r.echipaIds)}</td>
        <td class="num c-green">${r.v}</td><td class="num c-red">${r.i}</td>
        <td class="td-muted pay-role">${payRoleText(r).split(' · ').map(x=>`<span>${esc(x)}</span>`).join('')}</td>
        <td>${freelancerBadge(r.freelancer)}</td>
        ${showDays ? days.map(d=>`<td class="num td-muted">${r.perDay[d]?money(r.perDay[d]):''}</td>`).join('') : ''}
        <td class="num">${money(r.net)}</td>
        ${showDays ? '' : `<td class="num td-muted pay-opt">${coefText(r.coef)}</td>`}
        <td class="num pay-gross-col">${money(r.brut)}</td>
        <td class="num td-muted">${money(r.ret)}</td>
        ${showDays ? '' : `<td class="num pay-opt">${money(r.net)}</td>`}
        <td class="num ${r.ded.total?'c-yellow':'td-muted'}">${r.ded.total?'−'+money(r.ded.total):''}</td>
        <td class="num td-gold pay-gross-col pay-gross-end"><strong>${money(r.dePlata)}</strong></td>
        ${showDays ? '' : `<td class="td-muted pay-obs">${esc(payObservation(r))}</td>`}</tr>${open ? payDetailHtml(r, cols) : ''}`; }).join('')
      : `<tr><td class="td-empty" colspan="${cols}">${t(filtered?'pa_none':'pl_none')}</td></tr>`}</tbody>
    ${rows.length ? `<tfoot><tr><td></td><td>${t('pl_total')}${filtered?` <span class="td-muted">(${rows.length} ${plural(rows.length,'pa_countSuffix')})</span>`:''}</td>
      <td class="num">${tot.v}</td><td class="num">${tot.i}</td><td></td><td></td>
      ${showDays ? days.map(d=>`<td class="num">${money(rows.reduce((s,r)=>s+(r.perDay[d]||0),0))}</td>`).join('') : ''}
      <td class="num">${money(tot.net)}</td>${showDays ? '' : '<td class="pay-opt"></td>'}<td class="num pay-gross-col">${money(tot.brut)}</td><td class="num">${money(tot.ret)}</td>${showDays ? '' : `<td class="num pay-opt">${money(tot.net)}</td>`}
      <td class="num">${tot.ded?'−'+money(tot.ded):''}</td><td class="num pay-gross-col pay-gross-end">${money(tot.dp)}</td>${showDays ? '' : '<td></td>'}</tr></tfoot>` : ''}
  </table></div>`;
}
let payRefOpen = new Set();
function payRefToggle(name){ payRefOpen.has(name) ? payRefOpen.delete(name) : payRefOpen.add(name); renderPlatiBodyOnly(); }
function payRefereesHtml(){
  const rows = refereePayRows(payState.from, payState.to);
  const tot = rows.reduce((s,r)=>({ zile:s.zile+r.zile, ore:s.ore+r.ore, net:s.net+r.net, brut:s.brut+r.brut, lipsa:s.lipsa+r.lipsa }), { zile:0, ore:0, net:0, brut:0, lipsa:0 });
  const cols = 9;
  const canToggle = isFullAdmin() || isAsistent();
  return `<div class="table-wrap">
    <div class="pay-toolbar" style="grid-template-columns:1fr auto auto">
      <div class="view-sub" style="margin:0">${t('ar2_regula')(TARIF_ARBITRI.ora, TARIF_ARBITRI.retinerePct, refereeGross(TARIF_ARBITRI.ora))}</div>
      <span class="pay-amount-note">${t('pl_sumeMdl')}</span>
      <button class="btn-primary btn-sm" onclick="exportArbitriExcel()">${t('re_excel')}</button>
    </div>
    ${tot.lipsa ? `<div class="te-problems" style="margin:12px 14px 0">${t('ar2_avertOreLipsa')(tot.lipsa)}</div>` : ''}
    <div class="table-scroll pay-scroll"><table class="pay-table">
      <thead><tr><th class="pay-caret-col"></th><th>${t('ar_th_arbitru')}</th><th>${t('fl_label')}</th><th class="num">${t('ar_zile')}</th><th class="num">${t('ar_ore')}</th><th class="num">${t('ar2_net')(TARIF_ARBITRI.ora)}</th><th class="num">${t('ar2_retinere')(TARIF_ARBITRI.retinerePct)}</th><th>${t('pl_th_observatie')}</th><th class="num pay-gross-col pay-gross-end">${t('pl_th_dePlataBrut')}</th></tr></thead>
      <tbody>${rows.length ? rows.map(r=>{ const open = payRefOpen.has(r.arbitru);
        const obs = r.lipsa ? t('ar2_obsLipsa')(r.lipsa) : '';
        return `<tr class="pay-row ${open?'open':''}" onclick="payRefToggle(${esc(JSON.stringify(r.arbitru))})">
          <td class="pay-caret-col"><span class="pay-caret">›</span></td><td class="td-name">${esc(r.arbitru)}</td>
          <td>${canToggle && r.ref ? `<button type="button" class="fl-toggle" title="${esc(t('fl_schimba'))}" onclick="event.stopPropagation(); toggleRefereeFreelancer('${r.ref.id}')">${freelancerBadge(r.freelancer)}</button>` : freelancerBadge(r.freelancer)}</td>
          <td class="num">${r.zile}</td><td class="num">${hoursText(r.ore)}</td><td class="num">${money(r.net)}</td><td class="num td-muted">${money(r.brut-r.net)}</td>
          <td class="pay-obs ${obs?'c-yellow':'td-muted'}">${esc(obs)}</td><td class="num td-gold pay-gross-col pay-gross-end"><strong>${money(r.brut)}</strong></td></tr>
          ${open ? `<tr class="pay-detail"><td colspan="${cols}"><div class="pay-matches" style="max-height:none">${r.items.map(it=>`<div class="pay-match ${it.missing?'lost':'won'}" style="grid-template-columns:96px 1fr 170px 90px">
            <span class="td-muted">${ddmm(it.day)} · ${CAL_WEEKDAYS_LONG[LANG==='ru'?'ru':'ro'][isoWeekday(it.day)].slice(0,3)}</span>
            <span>${it.entries.map(e=>e.oraStart&&e.oraStop?`${e.oraStart}–${e.oraStop}`:t('ar_faraOre')).join(', ')}</span>
            <span class="td-muted">${hoursText(it.hours)} × ${TARIF_ARBITRI.ora} = ${money(it.net)} net${r.freelancer?'':` · ${t('fl_nu')}`}</span>
            <span class="num td-gold">${money(it.brut)}</span></div>`).join('')}</div></td></tr>` : ''}`; }).join('')
        : `<tr><td class="td-empty" colspan="${cols}">${t('ar_niciunArbitru')}</td></tr>`}</tbody>
      ${rows.length ? `<tfoot><tr><td></td><td>${t('pl_total')}</td><td></td><td class="num">${tot.zile}</td><td class="num">${hoursText(tot.ore)}</td><td class="num">${money(tot.net)}</td><td class="num">${money(tot.brut-tot.net)}</td><td></td><td class="num pay-gross-col pay-gross-end">${money(tot.brut)}</td></tr></tfoot>` : ''}
    </table></div>
    <div class="view-sub" style="padding:10px 16px 14px;margin:0">${t('ar2_hint')}</div>
  </div>`;
}
function exportArbitriExcel(){
  if(!window.XLSX){ alert('Excel indisponibil'); return; }
  const rows = refereePayRows(payState.from, payState.to);
  const r2 = v=>Math.round(v*100)/100;
  const head = [t('ar_th_arbitru'), t('fl_label'), t('ar_zile'), t('ar_ore'), t('ar2_net')(TARIF_ARBITRI.ora), t('ar2_retinere')(TARIF_ARBITRI.retinerePct), t('pl_th_dePlataBrut')];
  const body = rows.map(r=>[r.arbitru, t(r.freelancer?'fl_da':'fl_nu'), r.zile, r2(r.ore), r2(r.net), r2(r.brut-r.net), r2(r.brut)]);
  const detailHead = [t('th_data'), t('ar_th_arbitru'), t('ar_interval'), t('ar_ore'), t('ar2_net')(TARIF_ARBITRI.ora), t('pl_th_dePlataBrut')];
  const detail = rows.flatMap(r=>r.items.map(it=>[fmtDate(it.day), r.arbitru, it.entries.map(e=>e.oraStart&&e.oraStop?`${e.oraStart}–${e.oraStop}`:'').join(', '), r2(it.hours), it.net, it.brut]));
  const sum = i => body.reduce((s,r)=>s+Number(r[i]||0),0);
  const ws = XLSX.utils.aoa_to_sheet([[`BSKT Cup — ${t('pl_tabArbitri')} ${fmtDate(payState.from)} – ${fmtDate(payState.to)}`], [t('ar2_regula')(TARIF_ARBITRI.ora, TARIF_ARBITRI.retinerePct, refereeGross(TARIF_ARBITRI.ora))], [], head, ...body,
    [t('pl_total'), '', sum(2), r2(sum(3)), r2(sum(4)), r2(sum(5)), r2(sum(6))], [], [t('ar_detaliiZile')], detailHead, ...detail]);
  ws['!cols'] = [{wch:16},{wch:24},{wch:16},{wch:10},{wch:14},{wch:16},{wch:16}];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, t('pl_tabArbitri').slice(0,30));
  XLSX.writeFile(wb, `bskt-arbitri_${payState.from}_${payState.to}.xlsx`);
}
function toggleRefereeFreelancer(id){
  const a = DB.arbitri.find(x=>x.id===id); if(!a) return;
  const next = !(a.freelancer!==false), name = `${a.nume} ${a.prenume}`;
  const line = `${t('fl_label')}: ${t(a.freelancer!==false?'fl_da':'fl_nu')} → ${t(next?'fl_da':'fl_nu')}`;
  const apply = async ()=>{
    const { error } = isAsistent()
      ? await sb.rpc('asistent_salveaza_arbitru', { p_id:id, p_freelancer:next, p_rezumat:`${name}: ${line}` })
      : await sb.from('arbitri').update({ freelancer:next }).eq('id', id).select('id').single();
    if(error){ alert(t('err_update')+' '+error.message); return false; }
    a.freelancer = next;
    if(!isAsistent()) await logAction(`A setat arbitrul ${name}: freelancer ${next?'da':'nu'}`);
    asLog = null; renderPlatiBodyOnly(); return true;
  };
  showReview(t('fl_reviewTitlu'), `<div class="review-list"><section class="review-item"><div class="review-head">${esc(name)}</div>
    <div class="review-line"><span>${esc(line)}</span><span></span></div></section></div>
    <div class="view-sub" style="margin:10px 0 0">${t(next?'fl_explDa':'fl_explNu')}</div>`, apply);
}
async function saveTarifArbitri(){
  const ora = Number(document.getElementById('ta-ora').value), retinerePct = Number(document.getElementById('ta-pct').value);
  if(!(ora>0) || !(retinerePct>=0 && retinerePct<100)){ alert(t('pl_completeazaTot')); return; }
  const value = JSON.stringify({ ora, retinerePct });
  const { error } = await sb.from('app_config').upsert({ key:'tarif_arbitri', value, updated_at:new Date().toISOString() });
  if(error){ alert(t('err_save')+' '+error.message); return; }
  TARIF_ARBITRI = { ora, retinerePct };
  await logAction(`A stabilit tariful arbitrilor: ${ora} lei net/oră (brut ${refereeGross(ora)} lei/oră)`);
  renderPlatiBodyOnly();
}
function payTeamsHtml(){
  const { rows, matches } = payRows();
  const teams = new Map();
  matches.filter(m=>winnerOf(m)).forEach(m=>{
    [[m.echipaAId,m.scorA,m.scorB],[m.echipaBId,m.scorB,m.scorA]].forEach(([eid,pf,pa])=>{
      const e = teams.get(eid) || { eid, m:0, v:0, i:0, players:new Set(), net:0, ret:0, brut:0 };
      e.m++; pf>pa ? e.v++ : e.i++;
      rosterOf(m.id, eid).forEach(r=>{ const fl = isFreelancer(r.participantId); e.players.add(r.participantId); e.net += r.sumaNet||0; e.ret += fl ? (r.retinere||0) : 0; e.brut += fl ? (r.sumaBruta||0) : (r.sumaNet||0); });
      teams.set(eid, e);
    });
  });
  const list = [...teams.values()].sort((a,b)=>b.net-a.net);
  const tot = list.reduce((s,e)=>({ net:s.net+e.net, ret:s.ret+e.ret, brut:s.brut+e.brut }), { net:0, ret:0, brut:0 });
  return `<div class="table-scroll pay-scroll"><table class="pay-table">
    <thead><tr><th>${t('pl_th_echipa')}</th><th class="num">${t('pl_th_m')}</th><th class="num">${t('pl_th_v')}–${t('pl_th_i')}</th><th class="num">${t('pl_jucatori')}</th><th class="num">${t('pl_th_net')}</th><th class="num">${t('pl_th_ret')}</th><th class="num">${t('pl_th_brut')}</th></tr></thead>
    <tbody>${list.length ? list.map(e=>`<tr class="pay-row" onclick="payView.tab='jucatori'; payView.team='${e.eid}'; render();">
      <td class="td-name">${teamDot(e.eid)}${esc(echipaName(e.eid))}</td><td class="num">${e.m}</td><td class="num td-muted">${e.v}–${e.i}</td><td class="num">${e.players.size}</td>
      <td class="num td-gold">${money(e.net)}</td><td class="num td-muted">${money(e.ret)}</td><td class="num">${money(e.brut)}</td></tr>`).join('') : `<tr><td class="td-empty" colspan="7">${t('pl_none')}</td></tr>`}</tbody>
    ${list.length ? `<tfoot><tr><td>${t('pl_total')}</td><td class="num">${matches.filter(m=>winnerOf(m)).length}</td><td></td><td class="num">${rows.length}</td><td class="num">${money(tot.net)}</td><td class="num">${money(tot.ret)}</td><td class="num">${money(tot.brut)}</td></tr></tfoot>` : ''}
  </table></div>
  <div class="view-sub" style="padding:10px 16px 14px;margin:0">${t('pl_echipeHint')}</div>`;
}
function renderPlati(){
  if(!payState) payState = defaultPayRange();
  const presets = [['week','pl_saptCurenta'],['lastWeek','pl_saptTrecuta'],['month','pl_lunaCurenta']];
  return `
  <div class="view-head"><div class="view-title">${t('pl_title')}</div>${syncHeaderBtn()}</div>
  <div class="view-sub">${t('pl_sub')}</div>

  <div class="pay-period">
    <div class="pay-period-label">${esc(payPeriodLabel(payState.from, payState.to))}</div>
    <div class="pay-period-dates">
      <input type="date" value="${payState.from}" onchange="setPayRange(this.value, payState.to)" aria-label="${esc(t('re_de_la'))}">
      <span class="td-muted">—</span>
      <input type="date" value="${payState.to}" onchange="setPayRange(payState.from, this.value)" aria-label="${esc(t('re_pana_la'))}">
    </div>
    <div class="pay-presets">${presets.map(([k,l])=>`<button type="button" class="toggle-btn" onclick="payPreset('${k}')">${t(l)}</button>`).join('')}</div>
    <button class="btn-primary btn-sm pay-export" onclick="exportPlatiExcel()">${t('re_excel')}</button>
  </div>
  ${renderWeekLocks(payState.from, payState.to)}
  ${syncStrip()}
  <div id="pay-body">${renderPlatiBody()}</div>`;
}
function renderPlatiBody(){
  const { rows, days, matches } = payRows();
  const tot = rows.reduce((s,r)=>({ net:s.net+r.net, ret:s.ret+r.ret, brut:s.brut+r.brut, ded:s.ded+r.ded.total, dp:s.dp+r.dePlata }), { net:0, ret:0, brut:0, ded:0, dp:0 });
  const scored = matches.filter(m=>winnerOf(m)).length, unscored = matches.length - scored;
  const teamsInPeriod = [...new Set(rows.flatMap(r=>r.echipaIds))];
  const tabBtn = (id, label, count)=>`<button type="button" class="pay-tab ${payView.tab===id?'active':''}" onclick="setPayTab('${id}')">${label}${count!=null?`<span class="pay-tab-count">${count}</span>`:''}</button>`;
  const missingRoster = payLoading ? [] : scoredWithoutRoster(matches);
  return `
  ${noRosterBanner(missingRoster)}
  <div class="pay-summary">
    <div class="pay-sum-main">
      <div class="pay-sum-label">${t('pl_dePlataTotalBrut')}</div>
      <div class="pay-sum-value">${money(tot.dp)} <span>MDL</span></div>
      <div class="pay-sum-sub">${scored} ${plural(scored,'mt_meciuriSuffix')} · ${days.length} ${plural(days.length,'pl_zile')} · ${rows.length} ${plural(rows.length,'pa_countSuffix')}${unscored?` · <span class="c-yellow">${unscored} ${t('pl_faraScor')}</span>`:''}</div>
    </div>
    <div class="pay-sum-chain">
      <div><span>${t('pl_th_brutNecesar')}</span><b>${money(tot.brut)}</b></div>
      <div class="${tot.ded?'c-yellow':''}"><span>− ${t('pl_deduceri')}</span><b>${money(tot.ded)}</b></div>
      <div><span>${t('pl_th_retinere15')}</span><b>${money(tot.ret)}</b></div>
      <div><span>${t('pl_th_netRamas')}</span><b>${money(tot.net)}</b></div>
    </div>
  </div>

  <div class="pay-tabs">${tabBtn('jucatori', t('pl_tabJucatori'), rows.length)}${tabBtn('echipe', t('pl_tabEchipe'), teamsInPeriod.length)}${tabBtn('arbitri', t('pl_tabArbitri'), refereePayRows(payState.from, payState.to).length)}${tabBtn('tarife', t('pl_tabTarife'))}</div>

  ${payView.tab==='tarife' ? renderTarife() + renderTarifeArbitri() : payView.tab==='arbitri' ? payRefereesHtml() : payView.tab==='echipe' ? `<div class="table-wrap">${payTeamsHtml()}</div>` : `
  <div class="table-wrap">
    <div class="pay-toolbar">
      <div class="search-bar" style="margin:0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input placeholder="${esc(t('pl_cauta'))}" value="${esc(payView.q)}" oninput="paySet('q', this.value)">
      </div>
      <select onchange="paySet('team', this.value)"><option value="">${t('pa_toateEchipele')}</option>${teamsInPeriod.map(id=>`<option value="${id}" ${payView.team===id?'selected':''}>${esc(echipaName(id))}</option>`).join('')}</select>
      <select onchange="paySet('sort', this.value)">${[['nume','pl_sortNume'],['dePlata','pl_sortDePlata'],['brut','pl_sortBrut'],['net','pl_sortNet'],['meciuri','pl_sortMeciuri'],['ded','pl_sortDed'],['echipa','pl_sortEchipa']].map(([k,l])=>`<option value="${k}" ${payView.sort===k?'selected':''}>${t(l)}</option>`).join('')}</select>
      <label class="check-line pay-days-toggle"><input type="checkbox" ${payView.days?'checked':''} onchange="paySet('days', this.checked)"> ${t('pl_arataZile')}</label>
      <span class="pay-amount-note">${t('pl_sumeMdl')}</span>
    </div>
    <div id="pay-table-box">${payTableHtml()}</div>
    <div class="view-sub" style="padding:10px 16px 14px;margin:0">${t('pl_hintRand')}</div>
  </div>`}`;
}
function renderTarifeArbitri(){
  return `<div class="table-wrap">
    <div class="table-header"><div><div class="table-title">${t('ar_tarifeTitle')}</div><div class="view-sub" style="margin:4px 0 0">${t('ar2_regula')(TARIF_ARBITRI.ora, TARIF_ARBITRI.retinerePct, refereeGross(TARIF_ARBITRI.ora))}</div></div></div>
    ${isFullAdmin() ? `<div class="form-grid" style="grid-template-columns:repeat(2,minmax(0,220px)) auto;padding:14px 16px">
      <div class="field"><label>${t('ar2_tOra')}</label><input id="ta-ora" type="number" min="0" step="0.5" value="${TARIF_ARBITRI.ora}"></div>
      <div class="field"><label>${t('pl_retinerePct')}</label><input id="ta-pct" type="number" min="0" max="99" step="0.5" value="${TARIF_ARBITRI.retinerePct}"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" onclick="saveTarifArbitri()">${t('btn_save')}</button></div>
    </div>` : ''}
  </div>`;
}
function renderTarife(){
  const today = todayISO();
  const cell = (rol, sit)=>{ const r = currentRate(rol, sit, today); if(!r) return '<td>—</td>';
    const brut = r.net/(1-r.retinerePct/100);
    return `<td class="num"><strong>${money(r.net)}</strong><div class="td-muted" style="font-size:11px">${t('pl_brut')} ${money(Math.round(brut*100)/100)} · −${money(Math.round((brut-r.net)*100)/100)}</div></td>`; };
  const history = [...new Set(DB.tarife.map(r=>r.valabilDeLa))].sort().reverse();
  return `<div class="table-wrap">
    <div class="table-header"><div><div class="table-title">${t('pl_tarifeTitle')}</div><div class="view-sub" style="margin:4px 0 0">${t('pl_tarifeSub')}</div></div></div>
    <div class="table-scroll"><table>
      <thead><tr><th>${t('pl_th_rol')}</th><th class="num">${t('pl_victorie')}</th><th class="num">${t('pl_infrangere')}</th></tr></thead>
      <tbody>${MATCH_ROLES.map(rol=>`<tr><td class="td-name">${esc(trEnum(rol))}</td>${cell(rol,'victorie')}${cell(rol,'înfrângere')}</tr>`).join('')}</tbody>
    </table></div>
    <div class="view-sub" style="padding:0 20px 14px">${t('pl_istoric')}: ${history.map(d=>fmtDate(d)).join(' · ')}</div>
  </div>
  ${isFullAdmin() ? `<div class="add-form">
    <div class="form-title">${t('pl_tarifNou')}</div>
    <div class="form-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="field"><label>${t('pl_valabilDeLa')}</label><input id="tf2-data" type="date" value="${today}"></div>
      <div class="field"><label>${t('pl_retinerePct')}</label><input id="tf2-pct" type="number" min="0" max="99" step="0.5" value="${currentRate('jucător','victorie',today)?.retinerePct ?? 15}"></div>
      ${MATCH_ROLES.flatMap(rol=>['victorie','înfrângere'].map(sit=>`<div class="field"><label>${esc(trEnum(rol))} · ${t(sit==='victorie'?'pl_victorie':'pl_infrangere')}</label><input id="tf2-${rol==='căpitan'?'c':rol==='jucător'?'j':'r'}-${sit==='victorie'?'v':'i'}" type="number" min="0" value="${currentRate(rol,sit,today)?.net ?? ''}"></div>`)).join('')}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button class="btn-ghost" onclick="recalcPlati()">${t('pl_recalc')}</button>
      <button class="btn-primary" onclick="saveTarife()">${t('pl_salveazaTarife')}</button>
    </div>
  </div>` : ''}`;
}
async function saveTarife(){
  const de = document.getElementById('tf2-data').value; if(!de) return;
  const pctv = Number(document.getElementById('tf2-pct').value);
  const rows = [];
  for(const rol of MATCH_ROLES) for(const sit of ['victorie','înfrângere']){
    const v = document.getElementById(`tf2-${rol==='căpitan'?'c':rol==='jucător'?'j':'r'}-${sit==='victorie'?'v':'i'}`).value;
    if(v==='' || Number(v)<0){ alert(t('pl_completeazaTot')); return; }
    rows.push({ valabil_de_la:de, rol, situatie:sit, net:Number(v), retinere_pct:pctv });
  }
  if(!confirm(t('pl_confirmTarife')(fmtDate(de)))) return;
  const { error } = await sb.from('tarife_plata').upsert(rows, { onConflict:'valabil_de_la,rol,situatie' });
  if(error){ alert(t('err_save')+' '+error.message); return; }
  const { data } = await sb.from('tarife_plata').select('*').order('valabil_de_la');
  DB.tarife = (data||[]).map(mapTarif);
  await logAction(`A stabilit tarife noi de plată valabile de la ${fmtDate(de)}`);
  // already-recorded matches keep their frozen pay unless recalculated
  if(DB.meciuri.some(m=>m.data>=de) && confirm(t('pl_confirmRecalc')(fmtDate(de)))){
    const { data:n, error:rErr } = await sb.rpc('recalculeaza_plati', { p_de_la: de });
    if(rErr){ alert(t('err_update')+' '+rErr.message); }
    else {
      [...rosterLoadedDays].filter(d=>d>=de).forEach(d=>rosterLoadedDays.delete(d));
      invalidateStats();
      await logAction(`A recalculat plățile meciurilor de la ${fmtDate(de)} (${n} rânduri)`);
      await openPlati(); return;
    }
  }
  render();
}
async function recalcPlati(){
  const de = document.getElementById('tf2-data').value; if(!de) return;
  if(!confirm(t('pl_confirmRecalc')(fmtDate(de)))) return;
  const { data, error } = await sb.rpc('recalculeaza_plati', { p_de_la: de });  // explicit button
  if(error){ alert(t('err_update')+' '+error.message); return; }
  [...rosterLoadedDays].filter(d=>d>=de).forEach(d=>rosterLoadedDays.delete(d));
  invalidateStats();
  await logAction(`A recalculat plățile meciurilor de la ${fmtDate(de)} (${data} rânduri)`);
  await openPlati();
}
function exportPlatiExcel(){
  if(!window.XLSX){ alert('Excel indisponibil'); return; }
  const { rows:all, days } = payRows();
  const rows = payFilteredRows(all);
  const r2 = v => Math.round((v||0)*100)/100;
  const head = [t('pl_th_jucator'), t('pl_th_echipa'), t('pl_th_victorii'), t('pl_th_infrangeri'), t('pl_th_rol'), t('fl_label'), ...(payView.days ? days.map(ddmm) : []),
    t('pl_th_netJucator'), t('pl_th_coef'), t('pl_th_brutNecesar'), t('pl_th_retinere15'), t('pl_th_netRamas'),
    t('nav_spalatorie'), t('nav_daune'), t('pl_th_dePlataBrut'), t('pl_th_observatie')];
  const body = rows.map(r=>[r.nume, r.echipe, r.v, r.i, payRoleText(r), t(r.freelancer?'fl_da':'fl_nu'), ...(payView.days ? days.map(d=>r.perDay[d]||0) : []),
    r2(r.net), r.coef==null?'':Math.round(r.coef*100)/100, r2(r.brut), r2(r.ret), r2(r.net), r.ded.spal, r.ded.daune, r2(r.dePlata), payObservation(r)]);
  const nDays = payView.days ? days.length : 0;
  const moneyIdx = new Set([6+nDays, 8+nDays, 9+nDays, 10+nDays, 11+nDays, 12+nDays, 13+nDays, ...Array.from({length:nDays},(_,k)=>6+k)]);
  const total = head.map((_,i)=> i===0 ? t('pl_total') : (i===2||i===3) ? body.reduce((s,r)=>s+r[i],0) : moneyIdx.has(i) ? r2(body.reduce((s,r)=>s+Number(r[i]||0),0)) : '');
  const ws = XLSX.utils.aoa_to_sheet([[`BSKT Cup — ${t('pl_title')} ${fmtDate(payState.from)} – ${fmtDate(payState.to)}`], [], head, ...body, total]);
  ws['!cols'] = head.map((h,i)=>({ wch: i===0?24 : i===1?20 : i===4?26 : i===5?11 : h===t('pl_th_observatie')?48 : 13 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, t('pl_title').slice(0,30));
  XLSX.writeFile(wb, `bskt-plati_${payState.from}_${payState.to}.xlsx`);
}

/* ══════════════════════ STATISTICI ══════════════════════ */
let statsState = { mode:'all', from:'', to:'', sort:'winRate', tab:'jucatori', q:'', team:'', minM:10 };
let statsData = null, statsLoading = false, statsError = null;
function statsRange(){
  const today = todayISO();
  if(statsState.mode==='week'){ const f = weekStart(today); return [f, addDays(f,6)]; }
  if(statsState.mode==='month'){ const f = today.slice(0,8)+'01'; return [f, addDays(addMonths(f,1),-1)]; }
  if(statsState.mode==='custom') return [statsState.from||null, statsState.to||null];
  return [null, null];
}
// ids of scored matches in the period that DO have a line-up — player stats only count those
let statsRosterIds = null;
async function loadStatsRosterIds(from, to){
  const rows = await selectPaged(()=>{
    let q = sb.from('meciuri').select('id, meci_jucatori!inner(id)').not('scor_a','is',null).not('scor_b','is',null).limit(1, { foreignTable:'meci_jucatori' }).order('id');
    if(from) q = q.gte('data', from); if(to) q = q.lte('data', to);
    return q;
  });
  return new Set(rows.map(r=>r.id));
}
function statsMissingRoster(){
  if(!statsRosterIds) return [];
  const [from, to] = statsRange();
  return DB.meciuri.filter(m=>winnerOf(m) && (!from || m.data>=from) && (!to || m.data<=to) && !statsRosterIds.has(m.id));
}
async function openStatistici(){
  statsLoading = true; statsError = null; renderStatsBodyOnly();
  try { [statsData, statsRosterIds] = await Promise.all([loadStats(...statsRange()), loadStatsRosterIds(...statsRange()).catch(e=>{ console.error(e); return null; })]); } catch(e){ statsError = e.message; }
  statsLoading = false;
  if(currentView==='statistici') renderStatsBodyOnly();
}
// everything below the period bar; the bar itself is never replaced, so typed dates are not interrupted
function renderStatsBodyOnly(){
  const body = document.getElementById('stats-body');
  if(currentView!=='statistici' || !body){ render(); return; }
  body.innerHTML = renderStatsBody();
  enhanceIcons(body);
}
function setStatsMode(mode){
  statsState.mode = mode;
  document.querySelectorAll('.stats-modes .toggle-btn').forEach(b=>b.classList.toggle('active', b.dataset.mode===mode));
  const custom = document.getElementById('stats-custom'); if(custom) custom.style.display = mode==='custom' ? '' : 'none';
  if(mode==='custom' && !(isCompleteDate(statsState.from) && isCompleteDate(statsState.to))) return;
  openStatistici();
}
function setStatsDate(key, value){
  if(!isCompleteDate(value)) return;
  statsState[key] = value;
  if(isCompleteDate(statsState.from) && isCompleteDate(statsState.to)){
    if(statsState.from > statsState.to) [statsState.from, statsState.to] = [statsState.to, statsState.from];
    openStatistici();
  }
}
function statsSet(key, value){ statsState[key] = value; if(key==='q') refreshStatsTable(); else renderStatsBodyOnly(); }
function refreshStatsTable(){ const box = document.getElementById('stats-table-box'); if(box){ box.innerHTML = statsPlayersTableHtml(); enhanceIcons(box); } else renderStatsBodyOnly(); }
function statsPlayerTeams(r){
  // ids of the teams a player appeared for, resolved from the names returned by the RPC
  return (r.echipe||'').split(', ').map(n=>DB.echipe.find(e=>e.nume===n)?.id).filter(Boolean);
}
function statsPlayersFiltered(){
  const q = searchNorm(statsState.q);
  const sorters = {
    winRate:(a,b)=>(b.winRate??0)-(a.winRate??0) || b.meciuri-a.meciuri,
    meciuri:(a,b)=>b.meciuri-a.meciuri, victorii:(a,b)=>b.victorii-a.victorii || b.meciuri-a.meciuri,
    plusMinus:(a,b)=>(b.plusMinus??-99)-(a.plusMinus??-99),
    rating:(a,b)=>(participant(b.participantId)?.rating??0)-(participant(a.participantId)?.rating??0),
    net:(a,b)=>b.totalNet-a.totalNet, nume:(a,b)=>participantName(a.participantId).localeCompare(participantName(b.participantId),'ro'),
  };
  return statsData.jucatori
    .filter(r=>r.meciuri >= (statsState.minM||0))
    .filter(r=>!statsState.team || statsPlayerTeams(r).includes(statsState.team))
    .filter(r=>!q || searchNorm(`${participantName(r.participantId)} ${r.echipe}`).includes(q))
    .sort(sorters[statsState.sort]||sorters.winRate);
}
function statsPlayersTableHtml(){
  const players = statsPlayersFiltered();
  const th = (key, label, cls='')=>`<th class="sortable ${cls} ${statsState.sort===key?'active':''}" onclick="statsSet('sort','${key}')">${label}${statsState.sort===key?' ↓':''}</th>`;
  return `<div class="table-scroll pay-scroll"><table class="pay-table stats-table">
    <thead><tr><th class="num">#</th>${th('nume', `${t('pl_th_jucator')}<span class="pay-th-sub">${t('sx_echipe')}</span>`)}${th('rating', t('sx_rating'), 'num')}
      ${th('meciuri', t('pl_th_m'), 'num')}${th('victorii', t('pl_th_victorii'), 'num')}<th class="num">${t('pl_th_infrangeri')}</th>
      ${th('winRate', t('sx_winRate'))}${th('plusMinus', '+/−', 'num')}<th class="num">${t('sx_capitanVM')}</th>${canSeeMoney() ? th('net', t('pl_th2_net'), 'num') : ''}</tr></thead>
    <tbody>${players.length ? players.map((r,i)=>{ const p = participant(r.participantId);
      return `<tr class="pay-row" onclick="openProfile('${r.participantId}')">
        <td class="num td-muted">${i+1}</td>
        <td class="pay-who"><span class="td-name">${esc(participantName(r.participantId))}</span>${playerTeamsHtml(r.participantId, statsPlayerTeams(r))}</td>
        <td class="num">${p?.rating ?? '—'}</td><td class="num">${r.meciuri}</td><td class="num c-green">${r.victorii}</td><td class="num c-red">${r.infrangeri}</td>
        <td><span class="rate-bar"><span style="width:${Math.round((r.winRate||0)*100)}%"></span></span>${pct(r.winRate)}</td>
        <td class="num ${(r.plusMinus||0)>=0?'c-green':'c-red'}">${signed(r.plusMinus)}</td>
        <td class="num td-muted">${r.meciuriCapitan?`${r.victoriiCapitan}/${r.meciuriCapitan}`:''}</td>
        ${canSeeMoney() ? `<td class="num td-gold">${money(r.totalNet)}</td>` : ''}</tr>`; }).join('')
      : `<tr><td class="td-empty" colspan="10">${t('sx_niciunJucator')}</td></tr>`}</tbody>
  </table></div>`;
}
function statsLeaders(){
  const MIN = 10;   // leaders need a meaningful number of games
  const eligible = statsData.jucatori.filter(r=>r.meciuri>=MIN);
  const top = (arr, f)=>arr.slice().sort(f)[0];
  return [
    { key:'sx_ldWin', r: top(eligible,(a,b)=>(b.winRate??0)-(a.winRate??0)||b.meciuri-a.meciuri), val:r=>pct(r.winRate), sub:r=>`${r.victorii}–${r.infrangeri}` },
    { key:'sx_ldPm', r: top(eligible,(a,b)=>(b.plusMinus??-99)-(a.plusMinus??-99)), val:r=>signed(r.plusMinus), sub:r=>`${r.meciuri} ${plural(r.meciuri,'mt_meciuriSuffix')}` },
    { key:'sx_ldActiv', r: top(statsData.jucatori,(a,b)=>b.meciuri-a.meciuri), val:r=>String(r.meciuri), sub:r=>playerTeamsText(r.participantId, statsPlayerTeams(r)) },
    { key:'sx_ldCap', r: top(statsData.jucatori.filter(x=>x.meciuriCapitan>=MIN),(a,b)=>(b.victoriiCapitan/b.meciuriCapitan)-(a.victoriiCapitan/a.meciuriCapitan)||b.meciuriCapitan-a.meciuriCapitan),
      val:r=>pct(r.victoriiCapitan/r.meciuriCapitan), sub:r=>`${r.victoriiCapitan}/${r.meciuriCapitan} ${t('sx_caCapitan')}` },
  ].filter(x=>x.r);
}
function renderStatsBody(){
  if(statsLoading || !statsData) return `<div class="alert-empty">${statsError ? esc(statsError) : t('st_loading2')}</div>`;
  const teams = statsData.echipe.slice().sort((a,b)=>(b.winRate??0)-(a.winRate??0) || (b.diferenta??0)-(a.diferenta??0));
  const captains = statsData.jucatori.filter(r=>r.meciuriCapitan>0).sort((a,b)=>b.victoriiCapitan-a.victoriiCapitan || b.meciuriCapitan-a.meciuriCapitan);
  const [from, to] = statsRange();
  const nMatches = DB.meciuri.filter(m=>m.scorA!=null && (!from || m.data>=from) && (!to || m.data<=to)).length;
  const best = teams[0];
  const tabBtn = (id, label, count)=>`<button type="button" class="pay-tab ${statsState.tab===id?'active':''}" onclick="statsSet('tab','${id}')">${label}<span class="pay-tab-count">${count}</span></button>`;
  const leaders = statsLeaders();
  const tab = statsState.tab;
  const missing = statsMissingRoster();
  return `
  ${noRosterBanner(missing, 'sx_faraLotAvert')}
  <div class="stats-overview">
    <div class="stats-overview-main">
      <div class="pay-sum-label">${t('sx_perioada')}</div>
      <div class="stats-overview-nums"><span><b>${nMatches}</b> ${plural(nMatches,'mt_meciuriSuffix')}</span><span><b>${statsData.jucatori.length}</b> ${plural(statsData.jucatori.length,'pa_countSuffix')}</span><span><b>${teams.length}</b> ${t('sx_echipeScurt')}</span></div>
      ${best ? `<div class="stats-best clickable" onclick="statsSet('tab','echipe')"><span class="pay-sum-label">${t('sx_ceaMaiBuna')}</span><span class="stats-best-name">${teamDot(best.echipaId)}${esc(echipaName(best.echipaId))}</span><span class="td-muted">${best.victorii}–${best.infrangeri} · ${pct(best.winRate)}</span></div>` : ''}
    </div>
    <div class="stats-leaders">${leaders.map(l=>`<button type="button" class="stats-leader" onclick="openProfile('${l.r.participantId}')">
      <span class="pay-sum-label">${t(l.key)}</span><span class="stats-leader-val">${l.val(l.r)}</span>
      <span class="stats-leader-name">${esc(participantName(l.r.participantId))}</span><span class="td-muted">${l.sub(l.r)}</span></button>`).join('')}</div>
  </div>

  <div class="pay-tabs">${tabBtn('jucatori', t('pl_tabJucatori'), statsData.jucatori.length)}${tabBtn('echipe', t('sx_tabEchipe'), teams.length)}${tabBtn('capitani', t('sx_capitani'), captains.length)}</div>

  ${tab==='echipe' ? `<div class="table-wrap"><div class="table-scroll pay-scroll"><table class="pay-table">
      <thead><tr><th class="num">#</th><th>${t('pl_th_echipa')}</th><th class="num">${t('pl_th_m')}</th><th class="num">${t('pl_th_victorii')}</th><th class="num">${t('pl_th_infrangeri')}</th><th>${t('sx_winRate')}</th><th class="num">${t('sx_marcate')}</th><th class="num">${t('sx_primite')}</th><th class="num">${t('sx_difMeci')}</th></tr></thead>
      <tbody>${teams.length ? teams.map((s,i)=>`<tr class="pay-row" onclick="statsState.tab='jucatori'; statsState.team='${s.echipaId}'; statsState.minM=0; renderStatsBodyOnly();">
        <td class="num td-muted">${i+1}</td><td class="td-name">${teamDot(s.echipaId)}${esc(echipaName(s.echipaId))}</td><td class="num">${s.meciuri}</td><td class="num c-green">${s.victorii}</td><td class="num c-red">${s.infrangeri}</td>
        <td><span class="rate-bar"><span style="width:${Math.round((s.winRate||0)*100)}%"></span></span>${pct(s.winRate)}</td><td class="num td-muted">${s.marcate}</td><td class="num td-muted">${s.primite}</td>
        <td class="num ${(s.diferenta||0)>=0?'c-green':'c-red'}">${signed(s.diferenta)}</td></tr>`).join('') : `<tr><td class="td-empty" colspan="9">${t('pl_none')}</td></tr>`}</tbody>
    </table></div><div class="view-sub" style="padding:10px 16px 14px;margin:0">${t('sx_hintEchipe')}</div></div>`
  : tab==='capitani' ? `<div class="table-wrap"><div class="table-scroll pay-scroll"><table class="pay-table">
      <thead><tr><th class="num">#</th><th>${t('sx_capitan')}<span class="pay-th-sub">${t('sx_echipe')}</span></th><th class="num">${t('sx_meciuriCapitan')}</th><th class="num">${t('pl_th_victorii')}</th><th class="num">${t('pl_th_infrangeri')}</th><th>${t('sx_winRate')}</th></tr></thead>
      <tbody>${captains.length ? captains.map((r,i)=>`<tr class="pay-row" onclick="openProfile('${r.participantId}')"><td class="num td-muted">${i+1}</td>
        <td class="pay-who"><span class="td-name">${esc(participantName(r.participantId))}</span>${playerTeamsHtml(r.participantId, statsPlayerTeams(r))}</td>
        <td class="num">${r.meciuriCapitan}</td><td class="num c-green">${r.victoriiCapitan}</td><td class="num c-red">${r.meciuriCapitan-r.victoriiCapitan}</td>
        <td><span class="rate-bar"><span style="width:${Math.round(r.victoriiCapitan/r.meciuriCapitan*100)}%"></span></span>${pct(r.victoriiCapitan/r.meciuriCapitan)}</td></tr>`).join('') : `<tr><td class="td-empty" colspan="6">${t('pl_none')}</td></tr>`}</tbody>
    </table></div></div>`
  : `<div class="table-wrap">
      <div class="pay-toolbar stats-toolbar2">
        <div class="search-bar" style="margin:0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input placeholder="${esc(t('pl_cauta'))}" value="${esc(statsState.q)}" oninput="statsSet('q', this.value)">
        </div>
        <select onchange="statsSet('team', this.value)"><option value="">${t('pa_toateEchipele')}</option>${teams.map(s=>`<option value="${s.echipaId}" ${statsState.team===s.echipaId?'selected':''}>${esc(echipaName(s.echipaId))}</option>`).join('')}</select>
        <select onchange="statsSet('sort', this.value)">${[['winRate','sx_sortWin'],['victorii','sx_sortVictorii'],['meciuri','pl_sortMeciuri'],['plusMinus','sx_sortPm'],['rating','sx_sortRating'],['net','pl_sortNet'],['nume','pl_sortNume']].filter(([k])=>k!=='net' || canSeeMoney()).map(([k,l])=>`<option value="${k}" ${statsState.sort===k?'selected':''}>${t(l)}</option>`).join('')}</select>
        <select onchange="statsSet('minM', Number(this.value))">${[0,5,10,20].map(n=>`<option value="${n}" ${statsState.minM===n?'selected':''}>${n?t('sx_minMeciuri')(n):t('sx_oriceNrMeciuri')}</option>`).join('')}</select>
      </div>
      <div id="stats-table-box">${statsPlayersTableHtml()}</div>
      <div class="view-sub" style="padding:10px 16px 14px;margin:0">${t('sx_pmHint')} ${t('sx_hintRand')}</div>
    </div>`}`;
}
function renderStatistici(){
  const modes = [['all','sx_tot'],['week','pl_saptCurenta'],['month','pl_lunaCurenta'],['custom','sx_interval']];
  return `
  <div class="view-head"><div class="view-title">${t('sx_title')}</div>${syncHeaderBtn()}</div>
  <div class="view-sub">${t('sx_sub')}</div>
  <div class="pay-period">
    <div class="toggle-group stats-modes">${modes.map(([m,k])=>`<button type="button" class="toggle-btn ${statsState.mode===m?'active':''}" data-mode="${m}" onclick="setStatsMode('${m}')">${t(k)}</button>`).join('')}</div>
    <div class="pay-period-dates" id="stats-custom" style="${statsState.mode==='custom'?'':'display:none'}">
      <input type="date" value="${statsState.from}" onchange="setStatsDate('from', this.value)" aria-label="${esc(t('re_de_la'))}">
      <span class="td-muted">—</span>
      <input type="date" value="${statsState.to}" onchange="setStatsDate('to', this.value)" aria-label="${esc(t('re_pana_la'))}">
    </div>
  </div>
  ${syncStrip()}
  <div id="stats-body">${renderStatsBody()}</div>`;
}

/* ══════════════════════ JUCĂTORI ══════════════════════ */
let participantSearchQuery = '';
let participantSort = { mode:'nume' };
let participantTeamFilter = '';
function renderParticipanti(){
  return `
  <div class="view-head"><div class="view-title">${t('pa_title')}</div>${syncHeaderBtn()}</div>
  <div class="view-sub">${t(isAsistent() ? 'as_paSub' : 'pa_sub')}</div>

  ${!hasActiveShift() ? '' : `<div class="add-form">
    <div class="form-title">${t('pa_addTitle')}</div>
    <div class="form-grid" style="grid-template-columns:repeat(5,1fr)">
      <div class="field"><label>${t('pa_nume')}</label><input id="pf-nume" placeholder="${t('pa_nume')}"></div>
      <div class="field"><label>${t('pa_prenume')}</label><input id="pf-prenume" placeholder="${t('pa_prenume')}"></div>
      <div class="field"><label>${t('fi_patronimic')}</label><input id="pf-patronimic"></div>
      <div class="field"><label>${t('pa_nastere')}</label><input id="pf-nastere" type="date"></div>
      <div class="field"><label>${t('pa_telefon')}</label><input id="pf-telefon" placeholder="${t('pa_telefonPh')}"></div>
      <div class="field"><label>${t('fi_echipa')}</label><select id="pf-echipa"><option value="">—</option>${echipeActive().map(e=>`<option value="${e.id}">${esc(e.nume)}</option>`).join('')}</select></div>
      <div class="field"><label>${t('fi_statutEchipa')}</label><select id="pf-rol">${TEAM_ROLES.map(r=>`<option value="${r}" ${r==='jucător'?'selected':''}>${esc(trEnum(r))}</option>`).join('')}</select></div>
      <div class="field"><label>${t('pa_marime')}</label><select id="pf-marime"><option value="">—</option>${PLAYER_SIZES.map(s=>`<option>${s}</option>`).join('')}</select></div>
      <div class="field"><label>${t('sx_rating')}</label><input id="pf-rating" type="number" min="0" max="100"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" onclick="addParticipant()">${t('pa_btnAdd')}</button></div>
    </div>
    <div class="view-sub" style="margin:8px 0 0">${t('pa_restFisa')}</div>
  </div>`}

  ${syncStrip()}

  <div class="search-bar">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
    <input id="p-search" placeholder="${t(isAsistent() ? 'as_paSearchPh' : 'pa_searchPh')}" value="${esc(participantSearchQuery)}" oninput="participantSearchQuery=this.value; refreshParticipantiTable();">
  </div>

  <div class="form-grid" style="grid-template-columns:1fr 1fr;margin-bottom:16px">
    <div class="field"><label>${t('fi_echipa')}</label><select onchange="participantTeamFilter=this.value; render();">
      <option value="">${t('pa_toateEchipele')}</option>
      ${echipeActive().map(e=>`<option value="${e.id}" ${participantTeamFilter===e.id?'selected':''}>${esc(e.nume)}</option>`).join('')}
      <option value="__none__" ${participantTeamFilter==='__none__'?'selected':''}>${t('ec_faraEchipa')}</option>
    </select></div>
    <div class="field"><label>${t('pa_sortare')}</label><select onchange="participantSort.mode=this.value; render();">
      <option value="nume" ${participantSort.mode==='nume'?'selected':''}>${t('pa_sortNume')}</option>
      <option value="echipa" ${participantSort.mode==='echipa'?'selected':''}>${t('pa_sortEchipa')}</option>
      <option value="rating" ${participantSort.mode==='rating'?'selected':''}>${t('pa_sortRating')}</option>
      <option value="statut" ${participantSort.mode==='statut'?'selected':''}>${t('pa_sortStatut')}</option>
    </select></div>
  </div>

  <div class="table-wrap">
    <div class="table-header"><div class="table-title" id="participanti-count">${participantiFiltered().length} ${plural(participantiFiltered().length,'pa_countSuffix')}</div></div>
    <div class="table-scroll"><table>
      <thead><tr><th></th><th>${t('pa_nume')}</th><th>${t('pa_prenume')}</th><th>${t('fi_echipa')}</th><th>${t('fi_nrEchipaShort')}</th><th>${t('fi_statutEchipaShort')}</th><th>${t('sx_rating')}</th><th>${t('pa_th_categorieSp')}</th>${isAsistent() ? '' : `<th>${t('pa_telefon')}</th>`}<th>${t('pa_th_avizMed')}</th><th>${t('fl_label')}</th><th>${t('th_statut')}</th></tr></thead>
      <tbody id="participanti-tbody">${participantiRows()}</tbody>
    </table></div>
  </div>`;
}
function participantiFiltered(){
  const q = searchNorm(participantSearchQuery);
  let rows = DB.participanti.filter(p => !q || searchNorm(`${p.nume} ${p.prenume} ${p.patronimic||''} ${p.telefon||''} ${p.club||''} ${echipaName(p.echipaId)} ${p.idnp||''}`).includes(q));
  if(participantTeamFilter==='__none__') rows = rows.filter(p=>!p.echipaId);
  else if(participantTeamFilter) rows = rows.filter(p=>p.echipaId===participantTeamFilter);
  const byNume = (a,b) => a.nume.localeCompare(b.nume,'ro') || a.prenume.localeCompare(b.prenume,'ro');
  const inact = (a,b) => (a.statut==='inactiv')-(b.statut==='inactiv');
  const sorters = {
    nume: (a,b)=>inact(a,b) || byNume(a,b),
    echipa: (a,b)=>inact(a,b) || (!a.echipaId)-(!b.echipaId) || echipaName(a.echipaId).localeCompare(echipaName(b.echipaId)) || (a.nrEchipa||9)-(b.nrEchipa||9) || byNume(a,b),
    rating: (a,b)=>inact(a,b) || (b.rating??-1)-(a.rating??-1) || byNume(a,b),
    statut: (a,b)=>inact(b,a) || byNume(a,b),
  };
  return rows.slice().sort(sorters[participantSort.mode]||sorters.nume);
}
function refreshParticipantiTable(){
  const tbody = document.getElementById('participanti-tbody');
  const count = document.getElementById('participanti-count');
  if(!tbody || !count) return;
  tbody.innerHTML = participantiRows();
  count.textContent = `${participantiFiltered().length} ${plural(participantiFiltered().length,'pa_countSuffix')}`;
}
function participantiRows(){
  const rows = participantiFiltered();
  if(!rows.length) return `<tr><td class="td-empty" colspan="12">${t('pa_none')}</td></tr>`;
  return rows.map(p=>`
    <tr class="clickable" onclick="openProfile('${p.id}')">
      <td>${p.fotoPath ? `<span class="avatar-dot" title="${esc(t('fi_foto'))}">${icon('participants')}</span>` : ''}</td>
      <td class="td-name">${esc(p.nume)}</td>
      <td>${esc(p.prenume)}</td>
      <td>${p.echipaId ? `${teamDot(p.echipaId)}${esc(echipaName(p.echipaId))}` : '<span class="td-muted">—</span>'}</td>
      <td class="td-muted">${p.nrEchipa||''}</td>
      <td>${p.rolEchipa && p.rolEchipa!=='jucător' ? `<span class="badge gold">${esc(trEnum(p.rolEchipa))}</span>` : `<span class="td-muted">${esc(trEnum(p.rolEchipa||'jucător'))}</span>`}</td>
      <td class="td-gold">${p.rating ?? ''}</td>
      <td>${p.categorieSportiva ? `<span class="badge muted">${esc(p.categorieSportiva)}</span>` : ''}</td>
      ${isAsistent() ? '' : `<td class="td-muted">${esc(p.telefon)}</td>`}
      <td class="td-muted">${fmtDate(p.dataAvizMedical)}</td>
      <td>${freelancerBadge(p.freelancer!==false)}</td>
      <td><span class="badge ${p.statut==='activ'?'green':'muted'}">${trEnum(p.statut)}</span></td>
    </tr>`).join('');
}
async function addParticipant(){
  const nume = document.getElementById('pf-nume').value.trim();
  const prenume = document.getElementById('pf-prenume').value.trim();
  if(!nume || !prenume){ alert(t('pa_needNumePrenume')); return; }
  const rating = document.getElementById('pf-rating').value;
  const row = {
    nume, prenume,
    patronimic: document.getElementById('pf-patronimic').value.trim() || null,
    data_nasterii: document.getElementById('pf-nastere').value || null,
    telefon: document.getElementById('pf-telefon').value.trim() || null,
    echipa_id: document.getElementById('pf-echipa').value || null,
    rol_echipa: document.getElementById('pf-rol').value,
    marime: document.getElementById('pf-marime').value || null,
    rating: rating==='' ? null : Number(rating),
    statut: 'activ',
  };
  const { data, error } = await sb.from('participanti').insert(row).select().single();
  if(error){ alert(t('err_save')+' '+error.message); return; }
  DB.participanti.unshift(mapParticipant(data));
  await logAction(`A înregistrat jucător nou: ${nume} ${prenume}`);
  render();
  openProfile(data.id);
  renderProfile(true);
}

/* ── Fișa personală: fields in the order of the paper form (1–33) ── */
const FISA_FIELDS = [
  { n:1, key:'numeComplet', label:'fi_numeComplet', virtual:true },
  { n:2, key:'dataNasterii', label:'pa_nastere', type:'date' }, { n:'2b', key:'locNastere', label:'fi_locNastere' },
  { n:3, key:'adresa', label:'fi_domiciliu' }, { n:4, key:'idnp', label:'fi_idnp' },
  { n:5, key:'telefon', label:'fi_telefon' }, { n:'5b', key:'contactRezerva', label:'fi_contactRezerva' }, { n:'5c', key:'persoanaContact', label:'fi_persoanaContact' }, { n:6, key:'email', label:'pa_email', type:'email' },
  { n:7, key:'serieAct', label:'fi_serieAct' }, { n:'7b', key:'nrAct', label:'fi_nrAct' }, { n:'7c', key:'dataEmiteriiAct', label:'fi_dataEmiterii', type:'date' }, { n:8, key:'stagiuSportivAni', label:'fi_stagiu', type:'number' },
  { n:9, key:'locMunca', label:'fi_locMunca' }, { n:10, key:'functia', label:'fi_functia' }, { n:11, key:'profilActivitate', label:'fi_profil' },
  { n:12, key:'club', label:'fi_club' }, { n:13, key:'echipaId', label:'fi_echipa', type:'team' }, { n:14, key:'nrEchipa', label:'fi_nrEchipa', type:'nr' },
  { n:15, key:'rolEchipa', label:'fi_statutEchipa', type:'role' }, { n:16, key:'clasament', label:'fi_clasament' }, { n:17, key:'categorieSportiva', label:'fi_categoria', type:'category' },
  { n:18, key:'primulAntrenor', label:'fi_primulAntrenor' }, { n:19, key:'recomandator', label:'fi_recomandator' }, { n:20, key:'garantIntegritate', label:'fi_garant' },
  { n:21, key:'inaltimeCm', label:'fi_inaltime', type:'number' }, { n:22, key:'greutateKg', label:'fi_greutate', type:'number' }, { n:23, key:'marime', label:'fi_marime', type:'size' },
  { n:24, key:'rezultateSport', label:'fi_rezultate', type:'long' },
  { n:25, key:'traumatisme', label:'fi_traumatisme', type:'long' }, { n:26, key:'contraindicatii', label:'fi_contraindicatii', type:'long' }, { n:27, key:'altSport', label:'fi_altSport' },
  { n:28, key:'experientaCompetitii', label:'fi_experienta', type:'long' }, { n:29, key:'contactePariuri', label:'fi_contactePariuri', type:'long' }, { n:'29b', key:'experientaPariere', label:'fi_experientaPariere', type:'long' },
  { n:30, key:'caracteristica', label:'fi_caracteristica', type:'long' },
  { n:31, key:'informatSecuritate', label:'fi_informat', type:'bool' }, { n:32, key:'acordDatePersonale', label:'fi_acord', type:'bool' },
  { n:33, key:'comentarii', label:'fi_comentarii', type:'long' },
];
const FISA_DB_COLUMN = {
  dataNasterii:'data_nasterii', locNastere:'loc_nastere', adresa:'adresa', idnp:'idnp', telefon:'telefon', contactRezerva:'contact_rezerva',
  persoanaContact:'persoana_contact', email:'email', serieAct:'serie_act', nrAct:'nr_act', dataEmiteriiAct:'data_emiterii_act',
  stagiuSportivAni:'stagiu_sportiv_ani', locMunca:'loc_munca', functia:'functia', profilActivitate:'profil_activitate', club:'club',
  echipaId:'echipa_id', nrEchipa:'nr_echipa', rolEchipa:'rol_echipa', clasament:'clasament', categorieSportiva:'categorie_sportiva',
  primulAntrenor:'primul_antrenor', recomandator:'recomandator', garantIntegritate:'garant_integritate', inaltimeCm:'inaltime_cm',
  greutateKg:'greutate_kg', marime:'marime', rezultateSport:'rezultate_sport', traumatisme:'traumatisme', contraindicatii:'contraindicatii',
  altSport:'alt_sport', experientaCompetitii:'experienta_competitii', contactePariuri:'contacte_pariuri', experientaPariere:'experienta_pariere',
  caracteristica:'caracteristica', informatSecuritate:'informat_securitate', acordDatePersonale:'acord_date_personale', comentarii:'comentarii',
};
function fisaValue(p, f, lang=LANG){
  const v = f.key==='numeComplet' ? [p.nume, p.prenume, p.patronimic].filter(Boolean).join(' ') : p[f.key];
  if(f.type==='date') return v ? fmtDate(v) : '';
  if(f.type==='team') return v ? echipaName(v) : '';
  if(f.type==='role') return v ? trEnum(v, lang) : '';
  if(f.type==='bool') return v ? (lang==='ru'?'Да':'Da') : (lang==='ru'?'Нет':'Nu');
  return v==null ? '' : String(v);
}
function fisaInput(p, f){
  const id = `ep-${f.key}`, v = p[f.key];
  if(f.type==='date') return `<input id="${id}" type="date" value="${esc(v||'')}">`;
  if(f.type==='number') return `<input id="${id}" type="number" min="0" value="${esc(v??'')}">`;
  if(f.type==='nr') return `<select id="${id}"><option value="">—</option>${[1,2,3,4].map(n=>`<option ${v===n?'selected':''}>${n}</option>`).join('')}</select>`;
  if(f.type==='team') return `<select id="${id}"><option value="">—</option>${DB.echipe.map(e=>`<option value="${e.id}" ${e.id===v?'selected':''}>${esc(e.nume)}</option>`).join('')}</select>`;
  if(f.type==='role') return `<select id="${id}">${TEAM_ROLES.map(r=>`<option value="${r}" ${r===v?'selected':''}>${esc(trEnum(r))}</option>`).join('')}</select>`;
  if(f.type==='category') return `<select id="${id}"><option value="">${t('pa_nespecificata')}</option>${SPORT_CATEGORIES.map(c=>`<option ${c===v?'selected':''}>${c}</option>`).join('')}</select>`;
  if(f.type==='size') return `<select id="${id}"><option value="">—</option>${PLAYER_SIZES.map(s=>`<option ${s===v?'selected':''}>${s}</option>`).join('')}</select>`;
  if(f.type==='bool') return `<label class="check-box"><input id="${id}" type="checkbox" ${v?'checked':''}><span>${t('fi_da')}</span></label>`;
  if(f.type==='long') return `<textarea id="${id}" rows="2">${esc(v||'')}</textarea>`;
  return `<input id="${id}" type="${f.type==='email'?'email':'text'}" value="${esc(v||'')}">`;
}
function readFisaInput(f){
  const el = document.getElementById(`ep-${f.key}`); if(!el) return undefined;
  if(f.type==='bool') return el.checked;
  const v = el.value.trim();
  if(v==='') return null;
  if(f.type==='number' || f.type==='nr') return Number(v);
  return v;
}

const photoUrlCache = new Map();
var photoUrl = async function(path){
  if(!path) return null;
  const hit = photoUrlCache.get(path);
  if(hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await sb.storage.from('fotografii').createSignedUrl(path, 3600);
  if(error) return null;
  photoUrlCache.set(path, { url:data.signedUrl, exp:Date.now()+50*60000 });
  return data.signedUrl;
};
async function fillProfilePhoto(p){
  const box = document.getElementById('profile-photo'); if(!box) return;
  const url = await photoUrl(p.fotoPath);
  if(url && document.getElementById('profile-photo')===box) box.innerHTML = `<img src="${esc(url)}" alt="">`;
}
async function uploadPhoto(input){
  const p = participant(currentProfileId); const file = input.files?.[0];
  if(!p || !file) return;
  if(file.size > 5*1024*1024){ alert(t('fi_fotoMare')); return; }
  const ext = (file.type.split('/')[1]||'jpg').replace('jpeg','jpg');
  const path = `${p.id}/${Date.now()}.${ext}`;
  const { error } = await sb.storage.from('fotografii').upload(path, file, { contentType:file.type, upsert:false });
  if(error){ alert(t('err_save')+' '+error.message); return; }
  const { error:uErr } = await sb.from('participanti').update({ foto_path:path }).eq('id', p.id);
  if(uErr){ alert(t('err_update')+' '+uErr.message); return; }
  p.fotoPath = path;
  await logAction(`A încărcat fotografia pentru ${participantName(p.id)}`);
  renderProfile(document.getElementById('ep-numeNume') ? true : false);
}

let profileStats = null;
function openProfile(id){
  currentProfileId = id;
  profileStats = null;
  renderProfile(false);
  openModal('profile-modal');
  loadStats(null, null).then(s=>{ profileStats = s; if(currentProfileId===id && !document.getElementById('ep-numeNume')) renderProfile(false); }).catch(()=>{});
}
function renderProfile(editing = false){
  const id = currentProfileId;
  const p = participant(id); if(!p) return;
  document.getElementById('profile-modal-title').textContent = `${p.nume} ${p.prenume}`;
  const editBtn = document.getElementById('profile-edit-btn');
  editBtn.style.display = (editing || !(hasActiveShift() || isAsistent())) ? 'none' : '';
  editBtn.title = t('pa_editTitle');
  const pdfBtn = document.getElementById('profile-pdf-btn');
  if(pdfBtn) pdfBtn.style.display = (editing || isAsistent()) ? 'none' : '';
  const deleteBtn = document.getElementById('profile-delete-btn');
  deleteBtn.style.display = (editing || !isFullAdmin()) ? 'none' : '';
  deleteBtn.title = t('pa_deleteTitle');
  const head = `<div class="profile-hero">
      <div class="profile-photo" id="profile-photo">${icon('participants')}</div>
      <div>
        <div class="profile-hero-name">${esc(p.nume)} ${esc(p.prenume)} ${esc(p.patronimic||'')}</div>
        <div class="profile-hero-sub">${p.echipaId?`${teamDot(p.echipaId)}${esc(echipaName(p.echipaId))}`:t('ec_faraEchipa')}${p.nrEchipa?` · #${p.nrEchipa}`:''} · ${esc(trEnum(p.rolEchipa||'jucător'))}${p.rating!=null?` · ★ ${p.rating}`:''}</div>
        ${editing ? `<label class="btn-ghost btn-sm upload-btn">${t('fi_incarcaFoto')}<input type="file" accept="image/jpeg,image/png,image/webp" onchange="uploadPhoto(this)" hidden></label>` : ''}
      </div>
    </div>`;

  if(editing && isAsistent()){
    document.getElementById('profile-modal-body').innerHTML = head + `
      <div class="view-sub" style="margin:0 0 12px">${t('as_profilNota')}</div>
      <div class="profile-edit-grid">
        <div class="field"><label>${t('th_statut')}</label><select id="ap-statut">
          <option value="activ" ${p.statut==='activ'?'selected':''}>${trEnum('activ')}</option>
          <option value="inactiv" ${p.statut==='inactiv'?'selected':''}>${trEnum('inactiv')}</option></select></div>
        <div class="field"><label>${t('pa_aviz')}</label><input id="ap-aviz" type="date" min="${addDays(todayISO(),-366)}" max="${todayISO()}" value="${esc(p.dataAvizMedical||'')}"></div>
        <div class="field"><label>${t('pa_dulap')}</label><input id="ap-dulap" value="${esc(p.nrDulap||'')}"></div>
        <div class="field"><label>${t('fl_label')}</label><select id="ap-freelancer">
          <option value="1" ${p.freelancer!==false?'selected':''}>${t('fl_daLung')}</option>
          <option value="0" ${p.freelancer===false?'selected':''}>${t('fl_nuLung')}</option></select></div>
      </div>
      <div class="profile-edit-actions">
        <button class="btn-ghost" onclick="renderProfile(false)">${t('btn_cancel')}</button>
        <button class="btn-primary" onclick="saveProfileAsistent()">${t('btn_save')}</button>
      </div>`;
    fillProfilePhoto(p);
    return;
  }
  if(editing){
    document.getElementById('profile-modal-body').innerHTML = head + `
      <div class="profile-edit-grid">
        <div class="field"><label>${t('pa_nume')}</label><input id="ep-numeNume" value="${esc(p.nume)}"></div>
        <div class="field"><label>${t('pa_prenume')}</label><input id="ep-prenumeNume" value="${esc(p.prenume)}"></div>
        <div class="field"><label>${t('fi_patronimic')}</label><input id="ep-patronimicNume" value="${esc(p.patronimic||'')}"></div>
        <div class="field"><label>${t('th_statut')}</label><select id="ep-statut">
          <option value="activ" ${p.statut==='activ'?'selected':''}>${trEnum('activ')}</option>
          <option value="inactiv" ${p.statut==='inactiv'?'selected':''}>${trEnum('inactiv')}</option></select></div>
        <div class="field"><label>${t('fl_label')}</label><select id="ep-freelancer">
          <option value="1" ${p.freelancer!==false?'selected':''}>${t('fl_daLung')}</option>
          <option value="0" ${p.freelancer===false?'selected':''}>${t('fl_nuLung')}</option></select></div>
        <div class="field"><label>${t('sx_rating')}</label><input id="ep-rating" type="number" min="0" max="100" value="${esc(p.rating??'')}"></div>
        <div class="field"><label>${t('pa_aviz')}</label><input id="ep-aviz" type="date" value="${esc(p.dataAvizMedical||'')}"></div>
        <div class="field"><label>${t('pa_dulap')}</label><input id="ep-dulap" value="${esc(p.nrDulap||'')}"></div>
        ${FISA_FIELDS.filter(f=>!f.virtual).map(f=>`<div class="field ${f.type==='long'?'span-2':''}"><label><span class="fisa-n">${String(f.n).replace(/b|c/,'')}.</span> ${t(f.label)}</label>${fisaInput(p, f)}</div>`).join('')}
      </div>
      <div class="profile-edit-actions">
        <button class="btn-ghost" onclick="renderProfile(false)">${t('btn_cancel')}</button>
        <button class="btn-primary" onclick="saveParticipantProfile()">${t('btn_save')}</button>
      </div>`;
    fillProfilePhoto(p);
    return;
  }

  const expira = p.dataAvizMedical ? addMonths(p.dataAvizMedical, 6) : null;
  const zile = expira ? daysDiff(expira) : null;
  const medicalInfo = expira
    ? `${fmtDate(p.dataAvizMedical)} → ${fmtDate(expira)} <span class="badge ${zile<0?'red':zile<=30?'yellow':'green'}">${zile<0?trEnum('expirat'):zile+' '+plural(zile,'pa_expiraLa')}</span>`
    : `<span class="badge muted">${t('pa_faraAviz')}</span>`;
  const list = (arr, mapFn) => arr.length ? `<div class="mini-list">${arr.map(mapFn).join('')}</div>` : `<div class="mini-empty">${t('pa_fara_inreg')}</div>`;
  const st = profileStats?.jucatori.find(r=>r.participantId===id);
  const filled = FISA_FIELDS.filter(f=>fisaValue(p,f)!=='' && f.type!=='bool').length;

  document.getElementById('profile-modal-body').innerHTML = head + `
    <div class="stats-row compact">
      <div class="stat-card"><div class="stat-label">${t('pl_th_m')}</div><div class="stat-value">${st?.meciuri ?? (profileStats?0:'…')}</div><div class="stat-sub">${st?`${st.victorii}–${st.infrangeri}`:''}</div></div>
      <div class="stat-card"><div class="stat-label">${t('sx_winRate')}</div><div class="stat-value">${st?pct(st.winRate):'—'}</div><div class="stat-sub">+/− ${st?signed(st.plusMinus):'—'}</div></div>
      <div class="stat-card"><div class="stat-label">${t('sx_capitan')}</div><div class="stat-value">${st?.meciuriCapitan||0}</div><div class="stat-sub">${st?.meciuriCapitan?`${st.victoriiCapitan} ${t('pl_th_v').toLowerCase()}`:''}</div></div>
      ${canSeeMoney() ? `<div class="stat-card"><div class="stat-label">${t('pl_th_net')}</div><div class="stat-value">${st?money(st.totalNet):'—'}</div><div class="stat-sub">MDL · ${t('sx_tot').toLowerCase()}</div></div>` : ''}
    </div>

    <div class="profile-grid">
      <div><div class="k">${t('th_statut')}</div><div class="v"><span class="badge ${p.statut==='activ'?'green':'muted'}">${trEnum(p.statut)}</span></div></div>
      <div><div class="k">${t('fl_label')}</div><div class="v">${freelancerBadge(p.freelancer!==false)}</div></div>
      <div><div class="k">${t('pa_aviz')} / ${LANG==='ru'?'истекает':'expiră'}</div><div class="v">${medicalInfo}</div></div>
      ${isAsistent() ? `<div><div class="k">${t('pa_dulap')}</div><div class="v">${esc(p.nrDulap)||'—'}</div></div>` : `
      <div><div class="k">${t('pa_dulap')}</div><div class="v">${esc(p.nrDulap)||'—'}</div></div>
      <div><div class="k">${t('fi_completare')}</div><div class="v">${filled}/${FISA_FIELDS.filter(f=>f.type!=='bool').length}</div></div>`}
      ${isAsistent() && p.categorieSportiva ? `<div><div class="k">${t('pa_th_categorieSp')}</div><div class="v">${esc(p.categorieSportiva)}</div></div>` : ''}
    </div>

    ${isAsistent() ? `<div class="view-sub" style="margin:12px 0 0">${t('as_jucDatePersonale')}</div>` : `<section class="profile-section fisa-section">
      <div class="profile-section-title">${t('fi_title')}</div>
      <div class="fisa-grid">${FISA_FIELDS.map(f=>{ const v = fisaValue(p,f); return `<div class="fisa-item ${f.type==='long'?'span-2':''}"><div class="k"><span class="fisa-n">${String(f.n).replace(/b|c/,'')}.</span> ${t(f.label)}</div><div class="v ${v?'':'td-muted'}">${v?esc(v):'—'}</div></div>`; }).join('')}</div>
    </section>`}

    <div class="profile-history-grid">
      <section class="profile-section"><div class="profile-section-title">${t('nav_spalatorie')}</div>
        ${list(DB.spalatorie.filter(s=>s.participantId===id), r=>`<div class="mini-row"><span>${esc(r.tipArticole||'')} · ${money(r.suma)} MDL</span><span>${fmtDate(r.data)}</span></div>`)}
      </section>
      <section class="profile-section"><div class="profile-section-title">${t('pa_k_cazari')}</div>
        ${list(DB.hostel.filter(h=>h.participantId===id), r=>`<div class="mini-row"><span>${esc(r.observatii)||t('pa_cazare_word')}</span><span>${fmtDate(r.dataCazare)}</span></div>`)}
      </section>
      <section class="profile-section"><div class="profile-section-title">${t('pa_k_lenjerie')}</div>
        ${list(DB.lenjerie.filter(l=>l.participantId===id), r=>`<div class="mini-row"><span>${t('pa_eliberat_returnat')}</span><span>${fmtDate(r.dataEliberare)} → ${r.dataReturnare?fmtDate(r.dataReturnare):t('pa_nereturnat')}</span></div>`)}
      </section>
      <section class="profile-section"><div class="profile-section-title">${t('pa_k_daune')}</div>
        ${list(DB.daune.filter(d=>d.participantId===id), r=>`<div class="mini-row"><span>${esc(r.inventarAfectat)} — ${esc(r.natura)} · ${money(r.valoareEstimata)} MDL</span><span>${fmtDate(r.data)}</span></div>`)}
      </section>
      <section class="profile-section"><div class="profile-section-title">${t('pa_k_observatii')}</div>
        ${list(DB.observatii.filter(o=>o.participantId===id), r=>`<div class="mini-row"><span>${esc(trEnum(r.categorie))}: ${esc(r.descriere)}</span><span>${fmtDate(r.data)}</span></div>`)}
      </section>
    </div>`;
  fillProfilePhoto(p);
}
async function saveParticipantProfile(){
  const p = participant(currentProfileId); if(!p) return;
  const nume = document.getElementById('ep-numeNume').value.trim();
  const prenume = document.getElementById('ep-prenumeNume').value.trim();
  if(!nume || !prenume){ alert(t('pa_needNumePrenume2')); return; }
  const rating = document.getElementById('ep-rating').value;
  const row = {
    nume, prenume,
    patronimic: document.getElementById('ep-patronimicNume').value.trim() || null,
    statut: document.getElementById('ep-statut').value,
    freelancer: document.getElementById('ep-freelancer').value==='1',
    rating: rating==='' ? null : Number(rating),
    data_aviz_medical: document.getElementById('ep-aviz').value || null,
    nr_dulap: document.getElementById('ep-dulap').value.trim() || null,
  };
  FISA_FIELDS.filter(f=>!f.virtual).forEach(f=>{ const v = readFisaInput(f); if(v!==undefined) row[FISA_DB_COLUMN[f.key]] = v; });
  if(!row.rol_echipa) row.rol_echipa = 'jucător';
  const saveBtn = document.querySelector('#profile-modal-body .profile-edit-actions .btn-primary');
  if(saveBtn){ saveBtn.disabled = true; saveBtn.textContent = t('btn_saving'); }
  const { data, error } = await sb.from('participanti').update(row).eq('id', p.id).select().single();
  if(error){
    alert(t('err_update')+' '+error.message);
    if(saveBtn){ saveBtn.disabled = false; saveBtn.textContent = t('btn_save'); }
    return;
  }
  Object.assign(p, mapParticipant(data));
  await logAction(`A actualizat fișa personală a jucătorului ${data.nume} ${data.prenume}`);
  render();
  renderProfile(false);
}
async function deleteParticipant(){
  const p = participant(currentProfileId); if(!p) return;
  const nume = `${p.nume} ${p.prenume}`;
  if(!confirm(t('pa_deleteConfirm')(nume))) return;
  const { data, error } = await sb.from('participanti').delete().eq('id', p.id).select();
  if(error){ alert(t('err_delete')+' '+error.message); return; }
  if(!data || !data.length){ alert(t('err_delete')+' '+t('err_noPerm')); return; }
  await logAction(`A șters jucătorul ${nume} (și toate înregistrările asociate)`);
  closeModal('profile-modal');
  await fetchAll();
  render();
}
async function imageToDataUrl(url){
  const res = await fetch(url); const blob = await res.blob();
  return await new Promise((ok, fail)=>{ const r = new FileReader(); r.onload = ()=>ok(r.result); r.onerror = fail; r.readAsDataURL(blob); });
}
// A4 version of the paper "Fișa personală a sportivului": numbered fields, value over a rule, caption below.
async function exportFisaPdf(){
  if(isAsistent()) return;
  const p = participant(currentProfileId); if(!p) return;
  if(!window.jspdf?.jsPDF){ alert(t('re_noPdf')); return; }
  const lang = LANG;
  const L = key => t(key, lang);
  const doc = new window.jspdf.jsPDF({ unit:'mm', format:'a4' });
  try { await ensurePdfFont(doc); } catch(e){ alert('PDF font: ' + e.message); return; }
  const W = 210, M = 16, inner = W - 2*M;
  doc.setFont('NotoSans','bold'); doc.setFontSize(18); doc.setTextColor(25,20,20);
  doc.text(L('fi_pdfTitlu'), M, 22);
  doc.setFont('NotoSans','normal'); doc.setFontSize(10); doc.setTextColor(110,100,95);
  doc.text(L('fi_pdfSub'), M, 28);
  doc.setDrawColor(31,150,66); doc.setLineWidth(.8); doc.line(M, 32, M+40, 32);
  // photo box top-right
  const px = W-M-32, py = 12;
  doc.setDrawColor(200,190,185); doc.setLineWidth(.3); doc.rect(px, py, 32, 40);
  if(p.fotoPath){
    try { const url = await photoUrl(p.fotoPath); if(url){ const dataUrl = await imageToDataUrl(url); doc.addImage(dataUrl, dataUrl.includes('image/png')?'PNG':'JPEG', px+.5, py+.5, 31, 39); } } catch(e){ console.warn('photo', e); }
  } else { doc.setFontSize(7); doc.setTextColor(170,160,155); doc.text(L('fi_foto'), px+16, py+21, { align:'center' }); }

  // rows of the paper form
  const R = keys => keys.map(k=>FISA_FIELDS.find(f=>f.key===k));
  const layout = [
    R(['numeComplet']), R(['dataNasterii','locNastere']), R(['adresa','idnp']),
    R(['telefon','contactRezerva','persoanaContact','email']), R(['serieAct','nrAct','dataEmiteriiAct','stagiuSportivAni']),
    R(['locMunca','functia','profilActivitate']), R(['club','echipaId','nrEchipa']), R(['rolEchipa','clasament','categorieSportiva']),
    R(['primulAntrenor','recomandator','garantIntegritate']), R(['inaltimeCm','greutateKg','marime']), R(['rezultateSport']),
    R(['traumatisme','contraindicatii','altSport']), R(['experientaCompetitii','contactePariuri','experientaPariere']),
    R(['caracteristica']), R(['informatSecuritate','acordDatePersonale']), R(['comentarii']),
  ];
  let y = 60;
  layout.forEach((cells, rowIdx)=>{
    const colW = (rowIdx<2 ? inner-36 : inner) / cells.length;
    doc.setFontSize(10);
    const lines = cells.map(f=>doc.splitTextToSize(fisaValue(p, f, lang) || ' ', colW-6));
    const h = Math.max(...lines.map(l=>l.length)) * 4.6 + 9;
    if(y + h > 285){ doc.addPage(); y = 18; }
    cells.forEach((f, i)=>{
      const x = M + i*colW;
      doc.setFont('NotoSans','bold'); doc.setFontSize(9); doc.setTextColor(31,150,66);
      if(i===0 || String(f.n).match(/^\d+$/)) doc.text(`${String(f.n).replace(/b|c/,'')}.`, x, y);
      doc.setFont('NotoSans','normal'); doc.setFontSize(10); doc.setTextColor(25,20,20);
      doc.text(lines[i], x+6, y);
      const lineY = y + (lines[i].length-1)*4.6 + 2;
      doc.setDrawColor(150,140,135); doc.setLineWidth(.2); doc.line(x+6, lineY, x+colW-3, lineY);
      doc.setFontSize(7); doc.setTextColor(120,110,105);
      doc.text(doc.splitTextToSize(L(f.label), colW-8), x+6, lineY+3.6);
    });
    y += h;
  });
  doc.setFontSize(7.5); doc.setTextColor(150,140,135);
  doc.text(`BSKT Cup · ${L('fi_pdfGenerat')} ${fmtDate(todayISO())}`, M, 292);
  doc.save(`fisa-personala_${p.nume}_${p.prenume}.pdf`.replace(/\s+/g,'-'));
  await logAction(`A exportat fișa personală (PDF) pentru ${participantName(p.id)}`);
}

/* ══════════════════════ SETĂRI BSKT ══════════════════════ */
function applyAppConfig(rows){
  const get = k => { try { return JSON.parse(rows.find(r=>r.key===k)?.value || 'null'); } catch(_){ return null; } };
  const ter = get('terenuri'), antr = get('antrenori'), ta = get('tarif_arbitri');
  TARIF_ARBITRI = { ora: Number(ta?.ora) > 0 ? Number(ta.ora) : DEFAULT_TARIF_ARBITRI.ora,
                    retinerePct: Number(ta?.retinerePct) >= 0 && ta?.retinerePct != null ? Number(ta.retinerePct) : DEFAULT_TARIF_ARBITRI.retinerePct };
  TERENURI = Array.isArray(ter) && ter.length ? ter : DEFAULT_TERENURI.slice();
  TRAINERS = Array.isArray(antr) ? antr : [];
}
async function saveListConfig(key, inputId){
  const list = document.getElementById(inputId).value.split(/[,\n]/).map(s=>s.trim()).filter(Boolean);
  const { error } = await sb.from('app_config').upsert({ key, value: JSON.stringify(list), updated_at: new Date().toISOString() });
  if(error){ alert(t('err_save')+' '+error.message); return; }
  if(key==='terenuri') TERENURI = list.length ? list : DEFAULT_TERENURI.slice();
  if(key==='antrenori') TRAINERS = list;
  await logAction(`A actualizat lista „${key}”: ${list.join(', ')}`);
  render();
}
async function addServiceEmployee(){
  const nume = document.getElementById('stf-angajat').value.trim(); if(!nume) return;
  const { data, error } = await sb.from('serviciu_administratori').upsert({ nume, activ:true }, { onConflict:'nume' }).select().single();
  if(error){ alert(t('err_save')+' '+error.message); return; }
  DB.serviciuAdministratori = DB.serviciuAdministratori.filter(a=>a.id!==data.id).concat(data).sort((a,b)=>a.nume.localeCompare(b.nume));
  await logAction(`A adăugat în personalul de serviciu: ${nume}`);
  render();
}
async function deactivateServiceEmployee(id){
  const a = DB.serviciuAdministratori.find(x=>x.id===id); if(!a) return;
  if(!confirm(t('stx_confirmDezactivare')(a.nume))) return;
  const { error } = await sb.from('serviciu_administratori').update({ activ:false }).eq('id', id);
  if(error){ alert(t('err_update')+' '+error.message); return; }
  DB.serviciuAdministratori = DB.serviciuAdministratori.filter(x=>x.id!==id);
  await logAction(`A scos din personalul de serviciu: ${a.nume}`);
  render();
}
function renderSetariBskt(){
  return `
  <div class="add-form">
    <div class="form-title">${t('stx_personal')}</div>
    <div class="view-sub" style="margin:-4px 0 14px">${t('stx_personalSub')}</div>
    <div class="form-grid" style="grid-template-columns:1fr auto">
      <div class="field"><label>${t('stx_numeAngajat')}</label><input id="stf-angajat" placeholder="${t('stx_numeAngajatPh')}"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" onclick="addServiceEmployee()">${t('st_ipAdauga')}</button></div>
    </div>
    <div class="mini-list" style="margin-top:12px">${DB.serviciuAdministratori.length ? DB.serviciuAdministratori.map(a=>`<div class="mini-row"><span>${esc(a.nume)}</span><button class="btn-danger btn-sm" onclick="deactivateServiceEmployee('${a.id}')">${t('stx_scoate')}</button></div>`).join('') : `<div class="mini-empty">${t('stx_personalNone')}</div>`}</div>
  </div>
  <div class="add-form">
    <div class="form-title">${t('stx_terenuri')}</div>
    <div class="form-grid" style="grid-template-columns:1fr auto">
      <div class="field"><label>${t('stx_listaVirgula')}</label><input id="stf-terenuri" value="${esc(TERENURI.join(', '))}"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" onclick="saveListConfig('terenuri','stf-terenuri')">${t('btn_save')}</button></div>
    </div>
  </div>
  <div class="add-form">
    <div class="form-title">${t('stx_antrenori')}</div>
    <div class="form-grid" style="grid-template-columns:1fr auto">
      <div class="field"><label>${t('stx_listaVirgula')}</label><input id="stf-antrenori" value="${esc(TRAINERS.join(', '))}" placeholder="${t('stx_antrenoriPh')}"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" onclick="saveListConfig('antrenori','stf-antrenori')">${t('btn_save')}</button></div>
    </div>
  </div>`;
}

function openModal(id){ document.getElementById(id).classList.add('visible'); }
function closeModal(id){ document.getElementById(id).classList.remove('visible'); }

/* ══════════════════════ CORECȚII ADMIN: editor de înregistrări ══════════════════════ */
// A full admin can correct any register row that was entered wrong. Each spec lists the editable fields:
//   plain   { col, prop, type:'text'|'textarea'|'number'|'date'|'time'|'select', label, options?, required?, min? }
//   custom  participant · person (participant or referee) · kit (clothing type + size → inventory item)
//           notifier (shift roster or admin account) · shiftAdmin · clock (timestamptz shown as HH:MM on the row's day)
// Stock-bearing rows (clothing, linen, referee balls) are re-balanced by database triggers on save/delete.
let recordEdit = null;
const hhmm = v => v ? String(v).slice(0,5) : '';
const optsOf = (arr, labelFn=x=>x) => arr.map(x=>({ value:x, label:labelFn(x) }));
// keep a value that is no longer offered (inactive trainer, renamed court) selectable instead of silently changing it
const withCurrent = (options, value) => value && !options.some(o=>o.value===value) ? [{ value, label:value }, ...options] : options;
function chisinauIso(day, time){
  const probe = new Date(`${day}T${time}:00Z`);
  const off = new Intl.DateTimeFormat('en-US', { timeZone:'Europe/Chisinau', timeZoneName:'longOffset' })
    .formatToParts(probe).find(p=>p.type==='timeZoneName')?.value.replace('GMT','') || '+00:00';
  return `${day}T${time}:00${off || '+00:00'}`;
}
function damageNotifierName(serviceId, accountId){
  return serviceId ? (DB.serviciuAdministratori.find(a=>a.id===serviceId)?.nume || '') : (accountId ? publicAdminName(DB.administratori.find(a=>a.id===accountId)) : '');
}
const RECORD_EDITORS = {
  intarzieri: { stateKey:'intarzieri', title:'nav_intarzieri', fields:[
    { type:'person' },
    { col:'data', prop:'data', type:'date', label:'th_data', required:true },
    { col:'minute_intarziere', prop:'minuteIntarziere', type:'number', label:'it_minute', min:0 },
    { col:'motiv', prop:'motiv', type:'text', label:'it_motiv' },
  ]},
  vestimentatie: { stateKey:'vestimentatie', title:'nav_vestimentatie', stock:true, fields:[
    { type:'person' },
    { col:'data', prop:'data', type:'date', label:'ve_data', required:true },
    { type:'kit' },
    { col:'cantitate', prop:'cantitate', type:'number', label:'ve_cantitate', min:1, required:true },
    { col:'data_returnare', prop:'dataReturnare', type:'date', label:'ve_th_returnare' },
  ]},
  serviciu: { stateKey:'serviciu', title:'nav_serviciu', fields:[
    { col:'data', prop:'data', type:'date', label:'th_data', required:true },
    { type:'shiftAdmin' },
    { type:'clock', col:'inceput_la', prop:'inceputLa', label:'se_startTime' },
    { type:'clock', col:'sfarsit_la', prop:'sfarsitLa', label:'se_endTime', after:'inceput_la' },
  ]},
  spalatorie: { stateKey:'spalatorie', title:'nav_spalatorie', fields:[
    { type:'participant', noneLabel:()=>t('sp_locatia') },
    { col:'data', prop:'data', type:'date', label:'th_data', required:true },
    { col:'tip_articole', prop:'tipArticole', type:'text', label:'sp_th_articole' },
    { col:'cantitate', prop:'cantitate', type:'number', label:'sp_cantitate', min:1, required:true },
    { col:'suma', prop:'suma', type:'number', label:'sp_suma', min:0, step:'0.01', required:true },
    { col:'data_returnare', prop:'dataReturnare', type:'date', label:'sp_th_returnare' },
  ]},
  hostel: { stateKey:'hostel', title:'nav_hostel', fields:[
    { type:'participant', required:true },
    { col:'data_cazare', prop:'dataCazare', type:'date', label:'th_data', required:true },
    { col:'statut', prop:'statut', type:'select', label:'ho_th_statut', options:()=>optsOf(['activ','închis'], trEnum) },
    { col:'observatii', prop:'observatii', type:'textarea', label:'ho_observatii' },
  ]},
  lenjerie: { stateKey:'lenjerie', title:'nav_lenjerie', stock:true, fields:[
    { type:'participant', required:true },
    { col:'sursa_stoc', prop:'sursaStoc', type:'select', label:'le_stockSource', options:()=>[{value:'nou',label:t('le_stockNew')},{value:'uzat',label:t('le_stockUsed')}] },
    { col:'data_eliberare', prop:'dataEliberare', type:'date', label:'le_th_eliberare', required:true },
    { col:'data_returnare', prop:'dataReturnare', type:'date', label:'le_th_returnare' },
  ]},
  daune: { stateKey:'daune', title:'nav_daune', fields:[
    { type:'participant', required:true },
    { col:'data', prop:'data', type:'date', label:'th_data', required:true },
    { col:'teren', prop:'teren', type:'select', label:'da2_teren', options:r=>withCurrent(optsOf(TERENURI), r.teren) },
    { col:'inventar_afectat', prop:'inventarAfectat', type:'text', label:'da2_inventarAfectat' },
    { col:'natura', prop:'natura', type:'text', label:'da2_natura' },
    { col:'stare', prop:'bunDeterioratDistrus', type:'select', label:'th_stare', options:()=>optsOf(['afectat','deteriorat','distrus'], trEnum) },
    { col:'valoare_estimata', prop:'valoareEstimata', type:'number', label:'da2_valoare', min:0, step:'0.01' },
    { type:'notifier' },
    { col:'observatii', prop:'observatii', type:'textarea', label:'da2_observatii' },
  ]},
  fair_play: { stateKey:'fairPlay', title:'nav_fairplay', fields:[
    { type:'participant', required:true },
    { col:'data', prop:'data', type:'date', label:'th_data', required:true },
    { col:'ora', prop:'ora', type:'time', label:'fp_ora' },
    { col:'platou', prop:'platou', type:'select', label:'fp_platou', options:r=>withCurrent(optsOf(TERENURI), r.platou) },
    { col:'tip_cartonas', prop:'tipCartonas', type:'select', label:'fp_cartonas', options:()=>optsOf(FAIRPLAY_TYPES, trEnum) },
    { col:'descriere', prop:'descriere', type:'textarea', label:'fp_descriere' },
  ]},
  arbitraj: { stateKey:'arbitraj', title:'nav_arbitraj', stock:true, fields:[
    { col:'data', prop:'data', type:'date', label:'th_data', required:true },
    { col:'arbitru', prop:'arbitru', type:'select', label:'ar_th_arbitru', required:true, options:r=>withCurrent(optsOf(arbitriActivi().map(a=>`${a.nume} ${a.prenume}`)), r.arbitru) },
    { col:'turneu', prop:'turneu', type:'select', label:'ar_turneu', options:r=>withCurrent(optsOf(TERENURI), r.turneu) },
    { col:'ora_start', prop:'oraStart', type:'time', label:'ar_oraStart' },
    { col:'ora_stop', prop:'oraStop', type:'time', label:'ar_oraStop' },
    { col:'cantitate_mingi', prop:'cantitateMingi', type:'number', label:'ar_mingiNoi', min:0, required:true },
    { col:'observatii', prop:'observatii', type:'textarea', label:'da2_observatii' },
  ]},
  treninguri: { stateKey:'treninguri', title:'nav_antrenamente', fields:[
    { type:'participant', required:true },
    { col:'antrenor', prop:'antrenor', type:'select', label:'an_antrenor', required:true, options:r=>withCurrent(optsOf(TRAINERS), r.antrenor) },
    { col:'data', prop:'data', type:'date', label:'th_data', required:true },
    { col:'ora', prop:'ora', type:'time', label:'an_ora' },
    { col:'suma_jucator', prop:'sumaJucator', type:'number', label:'ed_sumaJucator', min:0, step:'0.01', required:true },
    { col:'suma_antrenor', prop:'sumaAntrenor', type:'number', label:'ed_sumaAntrenor', min:0, step:'0.01', required:true },
    { col:'observatii', prop:'observatii', type:'textarea', label:'da2_observatii' },
  ]},
  sarcini: { stateKey:'sarcini', title:'nav_sarcini', fields:[
    { col:'data_inreg', prop:'dataInreg', type:'date', label:'th_data', required:true },
    { col:'descriere', prop:'descriere', type:'textarea', label:'ta_descriere', required:true },
    { col:'actiuni', prop:'actiuni', type:'textarea', label:'ed_actiuni' },
    { col:'data_solutionare', prop:'dataSolutionare', type:'date', label:'ed_dataSolutionare' },
  ]},
  observatii: { stateKey:'observatii', title:'nav_observatii', fields:[
    { col:'data', prop:'data', type:'date', label:'th_data', required:true },
    { type:'participant', noneLabel:()=>t('ed_faraJucator') },
    { col:'subiect', prop:'subiect', type:'text', label:'ob_subject' },
    { col:'categorie', prop:'categorie', type:'select', label:'ob_categorie', options:r=>withCurrent(optsOf(OBS_CATEGORIES, trEnum), r.categorie) },
    { col:'descriere', prop:'descriere', type:'textarea', label:'th_descriere' },
  ], validate:p=>(!p.participant_id && !String(p.subiect||'').trim()) ? t('ob_needSubject') : null },
  pauze_tehnice: { stateKey:'pauzeTehnice', title:'nav_pauzatehnica', fields:[
    { col:'data', prop:'data', type:'date', label:'th_data', required:true },
    { col:'ora_start', prop:'oraStart', type:'time', label:'pt_oraStart', required:true },
    { col:'ora_stop', prop:'oraStop', type:'time', label:'pt_oraStop', required:true },
    { col:'teren', prop:'teren', type:'select', label:'pt_teren', options:r=>withCurrent(optsOf(TERENURI), r.teren) },
    { col:'descriere', prop:'descriere', type:'textarea', label:'pt_descriere', required:true },
  ]},
  inventar: { stateKey:'inventar', title:'nav_inventar', hint:'ed_inventarHint', fields:[
    { col:'denumire', prop:'denumire', type:'text', label:'iv_th_articol', required:true },
    { col:'culoare', prop:'culoare', type:'text', label:'iv_th_culoare' },
    { col:'marime', prop:'marime', type:'text', label:'iv_th_marime' },
    { col:'um', prop:'um', type:'text', label:'iv_th_um', required:true },
    { col:'cantitate_initiala', prop:'cantitateInitiala', type:'number', label:'iv_th_initial', min:0, required:true },
    { col:'cantitate_minima', prop:'cantitateMinima', type:'number', label:'iv_th_minim', min:0, required:true },
    { col:'observatii', prop:'observatii', type:'textarea', label:'da2_observatii' },
  ]},
};
function editBtn(collection, id){
  return isFullAdmin() ? `<button class="btn-ghost btn-sm" onclick="openRecordEditor('${collection}','${id}')" title="${esc(t('ed_editTitle'))}">${t('ed_edit')}</button>` : '';
}
function recordOf(collection, id){ return (DB[RECORD_EDITORS[collection].stateKey]||[]).find(r=>String(r.id)===String(id)); }
function openRecordEditor(collection, id){
  if(!isFullAdmin() || !RECORD_EDITORS[collection]) return;
  const rec = recordOf(collection, id); if(!rec) return;
  recordEdit = { collection, id };
  const spec = RECORD_EDITORS[collection];
  document.getElementById('record-modal-title').textContent = `${t('ed_edit')} · ${t(spec.title)}`;
  document.getElementById('record-modal-body').innerHTML = `
    ${spec.hint ? `<div class="view-sub" style="margin:0 0 14px">${t(spec.hint)}</div>` : ''}
    <div class="record-grid">${spec.fields.map((f,i)=>recordFieldHtml(f, i, rec)).join('')}</div>
    <div class="profile-edit-actions">
      <button type="button" class="btn-ghost" onclick="closeModal('record-modal')">${t('btn_cancel')}</button>
      <button type="button" class="btn-primary" onclick="saveRecordEditor()">${t('btn_save')}</button>
    </div>`;
  openModal('record-modal');
}
function recordFieldHtml(f, i, rec){
  const id = `re-${i}`;
  const wrap = (label, inner, wide) => `<div class="field ${wide?'wide':''}"><label>${esc(label)}</label>${inner}</div>`;
  const sel = (sid, options, value) => `<select id="${sid}">${options.map(o=>`<option value="${esc(o.value)}" ${String(o.value)===String(value??'')?'selected':''}>${esc(o.label)}</option>`).join('')}</select>`;
  switch(f.type){
    case 'participant': {
      const opts = DB.participanti.slice().sort((a,b)=>a.nume.localeCompare(b.nume,'ro')).map(p=>({ value:p.id, label:`${p.nume} ${p.prenume}${p.statut==='activ'?'':' · '+trEnum('inactiv')}` }));
      const all = f.noneLabel ? [{ value:'', label:f.noneLabel() }, ...opts] : opts;
      return wrap(t('th_participant'), autocompleteField(id, all, { selectedValue: rec.participantId || '' }), true);
    }
    case 'person': {
      const value = rec.participantId ? 'participant:'+rec.participantId : rec.arbitru ? 'referee:'+rec.arbitru : '';
      let opts = participantAndRefereeAcOptions();
      if(rec.participantId && !opts.some(o=>o.value===value)) opts = [{ value, label:participantName(rec.participantId) }, ...opts];
      if(rec.arbitru && !opts.some(o=>o.value===value)) opts = [{ value, label:`${rec.arbitru} · ${t('ar_th_arbitru')}` }, ...opts];
      return wrap(t('th_participant'), autocompleteField(id, opts, { selectedValue: value }), true);
    }
    case 'kit': {
      const kit = CLOTHING_TYPES.find(c=>c.tip===rec.tip) || CLOTHING_TYPES[0];
      const sizes = CLOTHING_SIZES.includes(rec.marime) ? CLOTHING_SIZES : [rec.marime, ...CLOTHING_SIZES].filter(Boolean);
      return wrap(t('ve_tip'), sel(id+'-tip', CLOTHING_TYPES.map(c=>({ value:c.cod, label:c.tip })), kit.cod))
        + wrap(t('ve_marime'), sel(id+'-marime', optsOf(sizes), rec.marime));
    }
    case 'notifier': {
      const value = rec.administratorServiciuAvertizorId ? 'service:'+rec.administratorServiciuAvertizorId : rec.adminAvertizorId ? 'account:'+rec.adminAvertizorId : '';
      const roster = DB.serviciuAdministratori.map(a=>`<option value="service:${a.id}" ${value==='service:'+a.id?'selected':''}>${esc(a.nume)}</option>`).join('');
      const accounts = realAdmins().map(a=>`<option value="account:${a.id}" ${value==='account:'+a.id?'selected':''}>${esc(adminName(a))}</option>`).join('');
      return wrap(t('da2_avertizor'), `<select id="${id}"><option value="">—</option><optgroup label="${esc(t('nav_serviciu'))}">${roster}</optgroup><optgroup label="${esc(t('st_admins'))}">${accounts}</optgroup></select>`);
    }
    case 'shiftAdmin':
      return wrap(t('th_administrator'), sel(id, DB.serviciuAdministratori.map(a=>({ value:a.id, label:a.nume })), rec.administratorServiciuId));
    case 'clock':
      return wrap(t(f.label), `<input id="${id}" type="time" value="${esc(rec[f.prop] ? fmtTime(rec[f.prop]) : '')}">`);
    case 'select':
      return wrap(t(f.label), sel(id, f.options(rec), rec[f.prop]));
    case 'textarea':
      return wrap(t(f.label), `<textarea id="${id}" rows="2">${esc(rec[f.prop]??'')}</textarea>`, true);
    default: {
      const v = f.type==='time' ? hhmm(rec[f.prop]) : (rec[f.prop] ?? '');
      return wrap(t(f.label), `<input id="${id}" type="${f.type}" value="${esc(v)}" ${f.min!=null?`min="${f.min}"`:''} ${f.step?`step="${f.step}"`:''}>`);
    }
  }
}
// read the form into a column payload; returns { payload } or { error }
function readRecordForm(spec, rec){
  const payload = {};
  const val = i => document.getElementById(`re-${i}`)?.value ?? '';
  for(const [i, f] of spec.fields.entries()){
    switch(f.type){
      case 'participant': {
        const v = val(i);
        if(!v && f.required) return { error:t('ed_needParticipant') };
        payload.participant_id = v || null; break;
      }
      case 'person': {
        const v = val(i);
        if(!v) return { error:t('ed_needParticipant') };
        const p = selectedPerson(v); payload.participant_id = p.participantId; payload.arbitru = p.arbitru; break;
      }
      case 'kit': {
        const kit = CLOTHING_TYPES.find(c=>c.cod===val(`${i}-tip`)); const marime = val(`${i}-marime`);
        Object.assign(payload, { tip:kit.tip, culoare:kit.culoare, marime, inventar_id:`inv-${kit.cod}-${String(marime).toLowerCase()}` }); break;
      }
      case 'notifier': {
        const [kind, nid] = val(i).split(':');
        payload.administrator_serviciu_avertizor_id = kind==='service' ? nid : null;
        payload.admin_avertizor_id = kind==='account' ? nid : null; break;
      }
      case 'shiftAdmin': payload.administrator_serviciu_id = val(i) || null; break;
      case 'clock': break;   // resolved below, needs the (possibly edited) day
      default: {
        let v = val(i);
        if(f.type!=='textarea' && typeof v==='string') v = v.trim();
        if(v==='' || v==null){
          if(f.required) return { error:t('ed_needField')(t(f.label)) };
          payload[f.col] = null; break;
        }
        if(f.type==='number'){
          const n = Number(v);
          if(!Number.isFinite(n) || (f.min!=null && n < f.min)) return { error:t('ed_badNumber')(t(f.label)) };
          payload[f.col] = n; break;
        }
        if(f.type==='date' && !isCompleteDate(v)) return { error:t('ed_badDate')(t(f.label)) };
        payload[f.col] = v;
      }
    }
  }
  // timestamps shown as clock times on the row's day; an end before the start rolls over midnight
  const day = payload.data || rec.data;
  for(const [i, f] of spec.fields.entries()){
    if(f.type!=='clock') continue;
    const v = val(i);
    if(!v){ payload[f.col] = null; continue; }
    let iso = chisinauIso(day, v);
    if(f.after && payload[f.after] && new Date(iso) <= new Date(payload[f.after])) iso = chisinauIso(addDays(day,1), v);
    payload[f.col] = iso;
  }
  const err = spec.validate?.(payload, rec);
  return err ? { error:err } : { payload };
}
// copy the saved row back into the in-memory record (same shapes as fetchAll)
function applyRecordRow(collection, rec, row){
  const spec = RECORD_EDITORS[collection];
  spec.fields.forEach(f=>{
    if(f.col){
      const v = row[f.col];
      rec[f.prop] = f.type==='number' ? (v==null ? null : Number(v)) : f.type==='time' ? hhmm(v) : v;
    }
  });
  if('participant_id' in row) rec.participantId = row.participant_id;
  if('arbitru' in row && collection!=='arbitraj') rec.arbitru = row.arbitru;
  if(collection==='vestimentatie') Object.assign(rec, { inventarId:row.inventar_id, tip:row.tip, culoare:row.culoare, marime:row.marime });
  if(collection==='serviciu'){
    rec.administratorServiciuId = row.administrator_serviciu_id;
    rec.administrator = DB.serviciuAdministratori.find(a=>a.id===row.administrator_serviciu_id)?.nume || rec.administrator;
  }
  if(collection==='daune'){
    rec.administratorServiciuAvertizorId = row.administrator_serviciu_avertizor_id; rec.adminAvertizorId = row.admin_avertizor_id;
    rec.avertizor = damageNotifierName(row.administrator_serviciu_avertizor_id, row.admin_avertizor_id);
  }
  if(collection==='treninguri') rec.ora = row.ora;
}
async function saveRecordEditor(){
  if(!recordEdit) return;
  const { collection, id } = recordEdit;
  const spec = RECORD_EDITORS[collection], rec = recordOf(collection, id);
  if(!rec) return;
  const { payload, error:formError } = readRecordForm(spec, rec);
  if(formError){ alert(formError); return; }
  if(collection==='pauze_tehnice'){
    const min = pauzaDurata(payload.ora_start, payload.ora_stop);
    if(min > 180 && !confirm(t('pt_confirmLunga')(min))) return;
  }
  const btn = document.querySelector('#record-modal-body .profile-edit-actions .btn-primary');
  if(btn){ btn.disabled = true; btn.textContent = t('btn_saving'); }
  const { data, error } = await sb.from(collection).update(payload).eq('id', id).select();
  if(btn){ btn.disabled = false; btn.textContent = t('btn_save'); }
  if(error){ alert(t('err_update')+' '+error.message); return; }
  if(!data?.length){ alert(t('err_update')+' '+t('ed_noPermission')); return; }
  applyRecordRow(collection, rec, data[0]);
  if(spec.stock) await refetchInventar();
  if(collection==='treninguri' || collection==='spalatorie' || collection==='daune') invalidateStats();
  await logAction(`A corectat o înregistrare din „${t(spec.title)}” (${fmtDate(rec.data || rec.dataCazare || rec.dataEliberare || rec.dataInreg || todayISO())})`);
  closeModal('record-modal');
  recordEdit = null;
  render();
}

/* ══════════════════════ ÎNTÂRZIERI ══════════════════════ */
function renderIntarzieri(){
  const perMonth = {};
  DB.intarzieri.forEach(i=>{ const m=i.data.slice(0,7); perMonth[m]=(perMonth[m]||0)+1; });
  const top = frequentLate().sort((a,b)=>b.count-a.count);
  return `
  <div class="view-head"><div class="view-title">${t('it_title')}</div></div>
  <div class="view-sub">${t('it_sub')}</div>

  <div class="stats-row">
    <div class="stat-card"><div class="stat-label">${t('it_totalInreg')}</div><div class="stat-value">${DB.intarzieri.length}</div></div>
    <div class="stat-card"><div class="stat-label">${t('it_lunaCurenta')}</div><div class="stat-value">${perMonth[todayISO().slice(0,7)]||0}</div></div>
    <div class="stat-card ${top.length?'warn':''}"><div class="stat-label">${t('it_frecventi')}</div><div class="stat-value ${top.length?'c-yellow':''}">${top.length}</div></div>
  </div>

  <div class="add-form">
    <div class="form-title">${t('it_addTitle')}</div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr 0.6fr 1fr auto">
      <div class="field"><label>${t('th_participant')}</label>${autocompleteField('if-participant', participantAndRefereeAcOptions())}</div>
      <div class="field"><label>${t('th_data')}</label><input id="if-data" type="date" value="${todayISO()}"></div>
      <div class="field"><label>${t('it_minute')}</label><input id="if-minute" type="number" min="0"></div>
      <div class="field"><label>${t('it_motiv')}</label><input id="if-motiv" type="text"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" ${disabledAttr()} onclick="addIntarziere()">${t('btn_add')}</button></div>
    </div>
  </div>

  ${top.length ? `<div class="table-wrap"><div class="table-header"><div class="table-title">${t('it_topTitle')}</div></div>
    <div class="table-scroll"><table><thead><tr><th>${t('th_participant')}</th><th>${t('it_nrIntarzieri')}</th></tr></thead><tbody>
      ${top.map(row=>`<tr><td class="td-name" ${row.participantId?`onclick="openProfile('${row.participantId}')"`:''}>${esc(entryPersonName(row))}</td><td class="td-gold">${row.count}</td></tr>`).join('')}
    </tbody></table></div></div>` : ''}

  <div class="table-wrap">
    <div class="table-header"><div class="table-title">${t('it_allTitle')}</div></div>
    <div class="table-scroll late-entries-scroll ${DB.intarzieri.length>10?'has-overflow':''}"><table>
      <thead><tr><th>${t('th_data')}</th><th>${t('th_participant')}</th><th>${t('it_minute')}</th><th>${t('it_motiv')}</th><th></th></tr></thead>
      <tbody>${DB.intarzieri.length ? DB.intarzieri.slice().sort((a,b)=>b.data.localeCompare(a.data)).map(i=>`
        <tr><td class="td-muted">${fmtDate(i.data)}</td><td class="td-name" ${i.participantId?`onclick="openProfile('${i.participantId}')"`:''}>${esc(entryPersonName(i))}</td>
        <td class="td-muted">${i.minuteIntarziere!=null?i.minuteIntarziere:'—'}</td><td class="td-muted">${esc(i.motiv||'—')}</td>
        <td class="row-actions">${editBtn('intarzieri', i.id)}<button class="btn-danger" ${disabledAttr(true)} onclick="removeRow('intarzieri','${i.id}')">${t('btn_delete')}</button></td></tr>`).join('') : `<tr><td class="td-empty" colspan="5">${t('it_none')}</td></tr>`}</tbody>
    </table></div>
  </div>`;
}
async function addIntarziere(){
  const person = selectedPerson(document.getElementById('if-participant').value);
  const participantId = person.participantId;
  const data = document.getElementById('if-data').value || todayISO();
  const minuteRaw = document.getElementById('if-minute').value;
  const minute_intarziere = minuteRaw === '' ? null : Number(minuteRaw);
  const motiv = document.getElementById('if-motiv').value.trim() || null;
  if(!participantId && !person.arbitru) return;
  const { data:row, error } = await sb.from('intarzieri').insert({ participant_id:participantId, arbitru:person.arbitru, data, minute_intarziere, motiv }).select().single();
  if(error){ alert('Salvarea a eșuat: ' + error.message); return; }
  DB.intarzieri.unshift({id:row.id, participantId:row.participant_id, arbitru:row.arbitru, data:row.data, minuteIntarziere:row.minute_intarziere, motiv:row.motiv});
  await logAction(`A înregistrat o întârziere pentru ${entryPersonName({participantId, arbitru:person.arbitru})}`);
  render();
}
async function removeRow(collection, id){
  const { data, error } = await sb.from(collection).delete().eq('id', id).select();
  if(error){ alert('Ștergerea a eșuat: ' + error.message); return; }
  if(!data || !data.length){ alert('Ștergerea a eșuat: nu aveți permisiunea necesară.'); return; }
  const stateKey = collection==='trusted_ips' ? 'trustedIps' : collection==='fair_play' ? 'fairPlay' : collection==='acte_schimb' ? 'acteSchimb' : collection==='pauze_tehnice' ? 'pauzeTehnice' : collection;
  if(Array.isArray(DB[stateKey])) DB[stateKey] = DB[stateKey].filter(r=>r.id!==id);
  else await fetchAll();
  await logAction(`A șters o înregistrare din „${collection}”`);
  render();
}

/* ══════════════════════ VESTIMENTAȚIE ══════════════════════ */
function renderVestimentatie(){
  return `
  <div class="view-head"><div class="view-title">${t('ve_title')}</div></div>
  <div class="view-sub">${t('ve_sub')}</div>

  <div class="add-form">
    <div class="form-title">${t('ve_addTitle')}</div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr 0.7fr 0.7fr 0.6fr auto">
      <div class="field"><label>${t('th_participant')}</label>${autocompleteField('vf-participant', participantAndRefereeAcOptions())}</div>
      <div class="field"><label>${t('ve_tip')}</label><select id="vf-tip">${CLOTHING_TYPES.map(ct=>`<option value="${ct.cod}">${esc(trEnum(ct.tip))}</option>`).join('')}</select></div>
      <div class="field"><label>${t('ve_marime')}</label><select id="vf-marime">${CLOTHING_SIZES.map(s=>`<option>${s}</option>`).join('')}</select></div>
      <div class="field"><label>${t('ve_cantitate')}</label><input id="vf-cantitate" type="number" min="1" value="1"></div>
      <div class="field"><label>${t('ve_data')}</label><input id="vf-data" type="date" value="${todayISO()}"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" ${disabledAttr()} onclick="addVestimentatie()">${t('ve_btnAdd')}</button></div>
    </div>
  </div>

  <div class="table-wrap">
    <div class="table-header">
      <div class="table-title">${DB.vestimentatie.length} ${plural(DB.vestimentatie.length,'ve_countSuffix')}</div>
      <div class="table-hint">${t('ve_hint')}</div>
    </div>
    <div class="table-scroll vestimentatie-scroll"><table>
      <thead><tr><th>${t('th_data')}</th><th>${t('th_participant')}</th><th>${t('ve_th_tip')}</th><th>${t('ve_marime')}</th><th>${t('ve_th_cantitate')}</th><th>${t('ve_th_returnare')}</th><th></th></tr></thead>
      <tbody>${DB.vestimentatie.length ? DB.vestimentatie.slice().sort((a,b)=>b.data.localeCompare(a.data)).map(v=>`
        <tr>
          <td class="td-muted">${fmtDate(v.data)}</td>
          <td class="td-name" ${v.participantId?`onclick="openProfile('${v.participantId}')"`:''}>${esc(entryPersonName(v))}</td>
          <td>${esc(trEnum(v.tip))}</td><td><span class="badge muted">${v.marime}</span></td>
          <td class="td-gold">${v.cantitate}</td>
          <td>${v.dataReturnare && !isFullAdmin()
            ? `<span class="badge green" title="${t('ve_lockedHint')}">${fmtDate(v.dataReturnare)}</span>`
            : `<button type="button" class="badge ${v.dataReturnare?'green':'yellow'}" ${disabledAttr()} onclick="toggleVestimentatieReturn('${v.id}')" title="${t('ve_hint')}">${v.dataReturnare?fmtDate(v.dataReturnare):trEnum('nereturnat')}</button>`}</td>
          <td class="row-actions">${editBtn('vestimentatie', v.id)}<button class="btn-danger" ${disabledAttr(true)} onclick="removeRow('vestimentatie','${v.id}')">${t('btn_delete')}</button></td>
        </tr>`).join('') : `<tr><td class="td-empty" colspan="7">${t('ve_none')}</td></tr>`}</tbody>
    </table></div>
  </div>`;
}
async function addVestimentatie(){
  const person = selectedPerson(document.getElementById('vf-participant').value);
  const participantId = person.participantId;
  if(!participantId && !person.arbitru) return;
  const kit = CLOTHING_TYPES.find(c=>c.cod===document.getElementById('vf-tip').value);
  if(!kit) return;
  const tip = kit.tip;
  const marime = document.getElementById('vf-marime').value;
  const inventar_id = `inv-${kit.cod}-${marime.toLowerCase()}`;
  const stocItem = DB.inventar.find(i=>i.id===inventar_id);
  const cantCeruta = parseInt(document.getElementById('vf-cantitate').value)||1;
  if(stocItem && inventoryCurrent(stocItem) < cantCeruta && !confirm(t('ve_stocInsuficient')(inventoryCurrent(stocItem)))) return;
  const cantitate = parseInt(document.getElementById('vf-cantitate').value)||1;
  const data = document.getElementById('vf-data').value || todayISO();
  const culoare = kit.culoare;
  const { data:row, error } = await sb.from('vestimentatie')
    .insert({ data, participant_id:participantId, arbitru:person.arbitru, inventar_id, tip, culoare, marime, cantitate })
    .select().single();
  if(error){ alert('Salvarea a eșuat: ' + error.message); return; }
  DB.vestimentatie.unshift({id:row.id, data:row.data, participantId:row.participant_id, arbitru:row.arbitru, inventarId:row.inventar_id, tip:row.tip, culoare:row.culoare, marime:row.marime, cantitate:row.cantitate, dataReturnare:row.data_returnare});
  await refetchInventar(); // un trigger în bază a scăzut deja stocul
  await logAction(`A eliberat ${cantitate}× ${tip} (${marime}) către ${entryPersonName({participantId, arbitru:person.arbitru})}`);
  render();
}
async function toggleVestimentatieReturn(id){
  const item = DB.vestimentatie.find(v=>v.id===id);
  if(!item) return;
  if(item.dataReturnare && !isFullAdmin()) return; // locked for locație — only admin can revert
  if(!item.dataReturnare && !isFullAdmin() && !confirm(t('ve_confirmReturn'))) return;
  const dataReturnare = item.dataReturnare ? null : todayISO();
  const { data, error } = await sb.from('vestimentatie').update({ data_returnare:dataReturnare }).eq('id', id).select();
  if(error){ alert('Actualizarea statutului a eșuat: ' + error.message); return; }
  if(!data || !data.length){ alert('Actualizarea a eșuat: nu aveți permisiunea necesară.'); return; }
  item.dataReturnare = dataReturnare;
  await refetchInventar(); // un trigger în bază a mutat stocul între nou/uzat
  await logAction(`${dataReturnare?'A marcat ca returnată':'A marcat ca nereturnată'} vestimentația lui ${entryPersonName(item)}`);
  render();
}

/* ══════════════════════ SERVICIU ══════════════════════ */
let serviciuFilter = { month:todayISO().slice(0,7) };
function serviciuMonthsAvailable(){
  const months = new Set(DB.serviciu.map(r=>r.data.slice(0,7)));
  months.add(todayISO().slice(0,7));
  return [...months].sort().reverse();
}
/* ── Month picker (reusable): ‹ month › bar + a year grid of 12 months, months with entries marked ──
   monthPicker(id, value, counts, onPick) — value 'YYYY-MM' or '' (all months); counts {'YYYY-MM': n};
   onPick: name of a global function called with the new value. */
const MONTHS_SHORT = { ro:['Ian','Feb','Mar','Apr','Mai','Iun','Iul','Aug','Sep','Oct','Noi','Dec'], ru:['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'] };
const monthPickers = {};   // id -> { open, year }
function monthPicker(id, value, counts, onPick, opts={}){
  const allowAll = opts.allowAll !== false;
  const st = monthPickers[id] || (monthPickers[id] = { open:false, year:null });
  const lang = LANG==='ru' ? 'ru' : 'ro';
  const cur = value || '';
  const n = cur ? (counts[cur]||0) : (opts.emptyCount ?? Object.values(counts).reduce((a,b)=>a+b,0));
  const step = d => cur ? addMonths(cur+'-01', d).slice(0,7) : todayISO().slice(0,7);
  const bar = `<div class="mcal-bar">
      <button type="button" class="mcal-step" onclick="${onPick}('${step(-1)}')" aria-label="${esc(t('mp_lunaAnterioara'))}">‹</button>
      <button type="button" class="mcal-trigger ${st.open?'open':''}" onclick="toggleMonthPicker(event,'${id}','${cur}')">
        <span class="mcal-trigger-icon">${icon('calendar')}</span>
        <span class="mcal-trigger-text"><strong>${cur ? monthLabel(cur) : (opts.emptyLabel || t('se_allMonths'))}</strong><span>${n} ${esc(plural(n,'sp_countSuffix'))}</span></span>
      </button>
      <button type="button" class="mcal-step" onclick="${onPick}('${step(1)}')" aria-label="${esc(t('mp_lunaUrmatoare'))}">›</button>
    </div>`;
  if(!st.open) return `<div class="mcal" id="mp-${id}">${bar}</div>`;
  const year = st.year || Number((cur || todayISO()).slice(0,4));
  const thisMonth = todayISO().slice(0,7);
  const yearTotal = Object.entries(counts).filter(([m])=>m.startsWith(String(year))).reduce((a,[,v])=>a+v,0);
  return `<div class="mcal" id="mp-${id}">${bar}
    <div class="mcal-pop mp-pop" onclick="event.stopPropagation()">
      <div class="mcal-head">
        <button type="button" class="mcal-nav" onclick="monthPickerYear('${id}',-1)">‹</button>
        <div class="mcal-title">${year}<span>${yearTotal} ${esc(plural(yearTotal,'sp_countSuffix'))}</span></div>
        <button type="button" class="mcal-nav" onclick="monthPickerYear('${id}',1)">›</button>
      </div>
      <div class="mp-grid">${MONTHS_SHORT[lang].map((name,i)=>{ const m = `${year}-${String(i+1).padStart(2,'0')}`; const c = counts[m]||0;
        return `<button type="button" class="mcal-cell mp-cell ${c?'has-games':''} ${m===cur?'selected':''} ${m===thisMonth?'today':''}" onclick="monthPickerPick('${id}','${onPick}','${m}')">
          <span class="mcal-num">${name}</span>${c?`<span class="mcal-count">${c}</span>`:''}</button>`; }).join('')}</div>
      <div class="mcal-foot">
        ${allowAll ? `<button type="button" class="btn-ghost btn-sm" onclick="monthPickerPick('${id}','${onPick}','')">${t('se_allMonths')}</button>` : '<span></span>'}
        <button type="button" class="btn-ghost btn-sm" onclick="monthPickerPick('${id}','${onPick}','${thisMonth}')">${t('mp_lunaCurenta')}</button>
      </div>
    </div></div>`;
}
// year bar in the same style: ‹ 2026 › with the number of entries that year
function yearPicker(value, counts, onPick){
  const y = Number(value || todayISO().slice(0,4));
  const n = Object.entries(counts).filter(([m])=>m.startsWith(String(y))).reduce((a,[,v])=>a+v,0);
  return `<div class="mcal-bar">
    <button type="button" class="mcal-step" onclick="${onPick}('${y-1}')" aria-label="${esc(t('mp_anAnterior'))}">‹</button>
    <div class="mcal-trigger mp-year"><span class="mcal-trigger-icon">${icon('calendar')}</span>
      <span class="mcal-trigger-text"><strong>${y}</strong><span>${n} ${esc(plural(n,'sp_countSuffix'))}</span></span></div>
    <button type="button" class="mcal-step" onclick="${onPick}('${y+1}')" aria-label="${esc(t('mp_anUrmator'))}">›</button>
  </div>`;
}
function countsByMonth(rows){ return rows.reduce((c,r)=>{ const m = r.data.slice(0,7); c[m]=(c[m]||0)+1; return c; }, {}); }
function refereeHours(a){ return (a.oraStart && a.oraStop) ? pauzaDurata(a.oraStart, a.oraStop)/60 : null; }
function hoursText(h){ return h==null ? '—' : (Math.round(h*100)/100).toLocaleString('ro-RO',{maximumFractionDigits:2})+' h'; }
// One row per referee for the period: hours worked × hourly net rate, whether alone or in a pair.
// Several entries of the same referee on one day (e.g. two shifts) are added together; an entry
// without start/end time counts 0 until the hours are filled in.
function refereePayRows(from, to){
  const days = {};
  DB.arbitraj.filter(a=>a.data>=from && a.data<=to).forEach(a=>{
    (days[a.data] ||= {})[a.arbitru] ||= [];
    days[a.data][a.arbitru].push(a);
  });
  const byRef = new Map();
  Object.entries(days).sort().forEach(([day, refs])=>{
    Object.entries(refs).forEach(([name, entries])=>{
      const hrs = entries.map(refereeHours);
      const missing = hrs.some(h=>h==null);
      const hours = hrs.reduce((s,h)=>s+(h||0),0);
      const fl = refereeFreelancer(name);
      const net = Math.round(hours*TARIF_ARBITRI.ora*100)/100, brut = fl ? refereeGross(net) : net;
      const e = byRef.get(name) || { arbitru:name, freelancer:fl, ref:refereeByName(name), zile:0, ore:0, net:0, brut:0, lipsa:0, items:[] };
      e.zile++; e.ore += hours; e.net += net; e.brut += brut;
      if(missing) e.lipsa++;
      e.items.push({ day, hours, net, brut, missing, entries });
      byRef.set(name, e);
    });
  });
  return [...byRef.values()].sort((a,b)=>a.arbitru.localeCompare(b.arbitru,'ro'));
}
function refereesOnDay(day, exceptId){ return [...new Set(DB.arbitraj.filter(a=>a.data===day && a.id!==exceptId).map(a=>a.arbitru))]; }
function setDauneMonth(m){ dauneFilter.month = m; render(); }
function setDauneYear(y){ dauneFilter.year = String(y); render(); }
function setFairPlayMonth(m){ fairPlayFilter.month = m; render(); }
function setFairPlayYear(y){ fairPlayFilter.year = String(y); render(); }
function setAntrenamenteMonth(m){ antrenamenteFilter.month = m; render(); }
function toggleMonthPicker(ev, id, cur){
  if(ev) ev.stopPropagation();
  const st = monthPickers[id] || (monthPickers[id] = {});
  st.open = !st.open; st.year = Number((cur || todayISO()).slice(0,4));
  render();
}
function monthPickerYear(id, d){ const st = monthPickers[id]; st.year += d; render(); }
function monthPickerPick(id, onPick, m){ monthPickers[id].open = false; window[onPick](m); }
document.addEventListener('click', e=>{
  const open = Object.entries(monthPickers).filter(([,st])=>st.open);
  if(!open.length) return;
  let changed = false;
  open.forEach(([id,st])=>{ if(!e.target.closest('#mp-'+id)){ st.open = false; changed = true; } });
  if(changed) render();
});
document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ let c=false; Object.values(monthPickers).forEach(st=>{ if(st.open){ st.open=false; c=true; } }); if(c) render(); } });
function setServiciuMonth(m){ serviciuFilter.month = m; render(); }
function serviciuRowsFiltered(){
  const month = serviciuFilter.month;
  return DB.serviciu.filter(r=>!month || r.data.slice(0,7)===month);
}
function renderServiciu(){
  const rows = serviciuRowsFiltered();
  const perAdmin = {};
  rows.forEach(s=>{ perAdmin[s.administrator]=(perAdmin[s.administrator]||0)+1; });
  const overlaps = (() => {
    const byDate = {};
    rows.forEach(s=>{ byDate[s.data]=byDate[s.data]||[]; byDate[s.data].push(s.administrator); });
    return Object.entries(byDate).filter(([,a])=>a.length>1);
  })();
  return `
  <div class="view-head"><div class="view-title">${t('se_title')}</div></div>
  <div class="view-sub">${t('se_sub')}</div>

  ${overlaps.length ? `<div class="locked-banner" style="border-color:rgba(248,81,73,.35);color:var(--red);background:rgba(248,81,73,.08)">${icon('alert')} ${t('se_overlap')} ${overlaps.map(([d])=>fmtDate(d)).join(', ')}</div>` : ''}

  <div class="add-form">
    <div class="form-title">${t('se_filterMonth')}</div>
    <div class="form-grid" style="grid-template-columns:minmax(0,520px) auto">
      <div class="field"><label>${t('se_month')}</label>${monthPicker('serviciu', serviciuFilter.month, DB.serviciu.reduce((c,r)=>{ const m = r.data.slice(0,7); c[m]=(c[m]||0)+1; return c; }, {}), 'setServiciuMonth')}</div>
      <div class="field" style="justify-content:flex-end"><button class="btn-ghost ${!serviciuFilter.month?'active':''}" onclick="setServiciuMonth('')">${t('se_allMonths')}</button></div>
    </div>
  </div>

  <div class="add-form">
    <div class="form-title">${t('se_addTitle')}</div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr auto">
      <div class="field"><label>${t('th_data')}</label><input id="sf-data" type="date" value="${todayISO()}"></div>
      <div class="field"><label>${t('th_administrator')}</label><select id="sf-admin">${DB.serviciuAdministratori.map(a=>`<option value="${a.id}">${esc(a.nume)}</option>`).join('')}</select></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" ${disabledAttr(true)} onclick="addServiciu()">${t('btn_add')}</button></div>
    </div>
  </div>

  <div class="table-wrap">
    <div class="table-header"><div class="table-title">${t('se_raportTitle')}</div></div>
    <div class="table-scroll"><table><thead><tr><th>${t('th_administrator')}</th><th>${t('se_nrSchimburi')}</th></tr></thead><tbody>
      ${Object.entries(perAdmin).map(([a,c])=>`<tr><td>${esc(a)}</td><td class="td-gold">${c}</td></tr>`).join('')}
    </tbody></table></div>
  </div>

  <div class="table-wrap">
    <div class="table-header"><div class="table-title">${t('se_calendarTitle')}</div></div>
    <div class="table-scroll service-calendar-scroll"><table>
      <thead><tr><th>${t('th_data')}</th><th>${t('th_administrator')}</th><th>${t('se_startTime')}</th><th>${t('se_endTime')}</th><th></th></tr></thead>
      <tbody>${rows.length ? rows.slice().sort((a,b)=>b.data.localeCompare(a.data)).map(s=>`
        <tr><td class="td-muted">${fmtDate(s.data)}</td><td>${esc(s.administrator)}</td>
        <td class="td-muted">${fmtTime(s.inceputLa)}</td><td class="td-muted">${fmtTime(s.sfarsitLa)}</td>
        <td class="row-actions">${editBtn('serviciu', s.id)}<button class="btn-danger" ${disabledAttr(true)} onclick="removeRow('serviciu','${s.id}')">${t('btn_delete')}</button></td></tr>`).join('') : `<tr><td class="td-empty" colspan="5">${t('se_none')}</td></tr>`}</tbody>
    </table></div>
  </div>`;
}
async function addServiciu(){
  const data = document.getElementById('sf-data').value || todayISO();
  const administratorServiciuId = document.getElementById('sf-admin').value;
  const serviciuAdmin = DB.serviciuAdministratori.find(a=>a.id===administratorServiciuId);
  if(!serviciuAdmin) return;
  const { data:row, error } = await sb.from('serviciu').insert({ data, administrator_serviciu_id:administratorServiciuId }).select().single();
  if(error){ alert('Salvarea a eșuat: ' + error.message); return; }
  DB.serviciu.push({id:row.id, data:row.data, administratorServiciuId:row.administrator_serviciu_id, inceputLa:row.inceput_la, sfarsitLa:row.sfarsit_la, administrator:serviciuAdmin.nume});
  await logAction(`A programat schimb pentru ${serviciuAdmin.nume} pe ${fmtDate(data)}`);
  render();
}

/* ══════════════════════ SPĂLĂTORIE ══════════════════════ */
let spalatorieFilter = { month:todayISO().slice(0,7) };
function spalatorieMonthsAvailable(){
  const months = new Set(DB.spalatorie.map(r=>r.data.slice(0,7)));
  months.add(todayISO().slice(0,7));
  return [...months].sort().reverse();
}
function setSpalatorieMonth(m){ spalatorieFilter.month = m; render(); }
function spalatorieFiltered(){
  const month = spalatorieFilter.month;
  return DB.spalatorie.filter(r => !month || r.data.slice(0,7)===month);
}
// Rows without a participant are the location's own laundry — they get their own bucket
// so the per-beneficiary totals still add up to the month's total spend.
function spalatorieBeneficiaryTotals(rows=spalatorieFiltered()){
  const byBeneficiary = new Map();
  rows.forEach(r=>{
    const key = r.participantId || '__locatie__';
    let entry = byBeneficiary.get(key);
    if(!entry){
      entry = {
        key,
        nume: r.participantId ? participantName(r.participantId) : t('sp_locatia'),
        operatiuni:0, articole:0, total:0,
      };
      byBeneficiary.set(key, entry);
    }
    entry.operatiuni += 1;
    entry.articole += Number(r.cantitate||1);
    entry.total += Number(r.suma||0);
  });
  return [...byBeneficiary.values()].sort((a,b)=> b.total-a.total || a.nume.localeCompare(b.nume,'ro'));
}
async function exportSpalatoriePdf(){
  if(!window.jspdf?.jsPDF){ alert(t('re_noPdf')); return; }
  const rows = spalatorieFiltered();
  const totals = spalatorieBeneficiaryTotals(rows);
  if(!totals.length){ alert(t('sp_raportNimic')); return; }
  const doc = new window.jspdf.jsPDF();
  try { await ensurePdfFont(doc); } catch(e){ alert('Fontul PDF nu s-a putut incarca: ' + e.message); return; }

  const perioada = spalatorieFilter.month ? monthLabel(spalatorieFilter.month) : t('sp_raportToate');
  const sum = f => totals.reduce((s,r)=>s+r[f],0);
  const totalGeneral = sum('total'), totalOperatiuni = sum('operatiuni'), totalArticole = sum('articole');

  doc.setFont('NotoSans','bold'); doc.setFontSize(15); doc.setTextColor(35,42,52);
  doc.text(t('sp_raportTitlu'), 12, 15);
  doc.setFont('NotoSans','normal'); doc.setFontSize(9); doc.setTextColor(85);
  doc.text(`${t('sp_raportPerioada')}: ${perioada}`, 12, 21.5);
  doc.text(`${t('sp_raportBeneficiari')}: ${totals.length}   ·   ${t('sp_operatiuni')}: ${totalOperatiuni}   ·   ${t('sp_totalChelt')}: ${totalGeneral} MDL`, 12, 26.5);
  doc.text(`${t('sp_raportGenerat')}: ${fmtDate(moldovaClock().dateKey)}`, 12, 31.5);

  const usable = doc.internal.pageSize.getWidth() - 24;
  const wNr = 11, wOperatiuni = 24, wArticole = 24, wTotal = 30;
  const wBeneficiar = usable - wNr - wOperatiuni - wArticole - wTotal;

  doc.autoTable({
    startY:36,
    head:[[t('sp_raportTh_nr'), t('sp_raportTh_beneficiar'), t('sp_raportTh_operatiuni'), t('sp_raportTh_articole'), t('sp_raportTh_total')]],
    body: totals.map((r,i)=>[
      i+1, pdfCell(r.nume), r.operatiuni, r.articole, `${r.total}`,
    ]),
    foot:[[ '', t('sp_raportTotalGeneral'), totalOperatiuni, totalArticole, `${totalGeneral}` ]],
    theme:'grid',
    margin:{left:12,right:12,top:12,bottom:12},
    styles:{font:'NotoSans', fontSize:8.2, cellPadding:2.1, lineColor:[205,210,218], lineWidth:.15, overflow:'linebreak'},
    headStyles:{font:'NotoSans', fontStyle:'bold', fillColor:[55,65,81], textColor:255, cellPadding:2.4, halign:'center'},
    footStyles:{font:'NotoSans', fontStyle:'bold', fillColor:[232,235,240], textColor:[35,42,52], cellPadding:2.4},
    alternateRowStyles:{fillColor:[247,249,251]},
    columnStyles:{
      0:{cellWidth:wNr, halign:'center'},
      1:{cellWidth:wBeneficiar},
      2:{cellWidth:wOperatiuni, halign:'center'},
      3:{cellWidth:wArticole, halign:'center'},
      4:{cellWidth:wTotal, halign:'right', fontStyle:'bold'},
    },
    rowPageBreak:'avoid',
    showFoot:'lastPage',
    didParseCell:d=>{ if(d.section==='foot' && d.column.index>=2) d.cell.styles.halign = d.column.index===4 ? 'right' : 'center'; },
  });
  doc.save(`spalatorie_${spalatorieFilter.month || 'total'}.pdf`);
}
function renderSpalatorie(){
  const rows = spalatorieFiltered();
  const total = rows.reduce((s,r)=>s+Number(r.suma||0),0);
  return `
  <div class="view-head"><div class="view-title">${t('sp_title')}</div></div>
  <div class="view-sub">${t('sp_sub')}</div>

  <div class="stats-row"><div class="stat-card"><div class="stat-label">${t('sp_totalChelt')}</div><div class="stat-value">${total} MDL</div><div class="stat-sub">${rows.length} ${plural(rows.length,'sp_operatiuni')}</div></div></div>

  <div class="add-form">
    <div class="form-title">${t('sp_addTitle')}</div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr 0.6fr 0.8fr 0.6fr auto">
      <div class="field"><label>${t('th_participant')}</label>${autocompleteField('sp-participant', participantAcOptions([{value:'',label:t('sp_locatia')}]), {selectedValue:''})}</div>
      <div class="field"><label>${t('sp_tipArt')}</label><input id="sp-tip" placeholder="${t('sp_tipArtPh')}"></div>
      <div class="field"><label>${t('sp_cantitate')}</label><input id="sp-cantitate" type="number" min="1" value="1"></div>
      <div class="field"><label>${t('sp_dataPredarii')}</label><input id="sp-data" type="date" value="${todayISO()}"></div>
      <div class="field"><label>${t('sp_suma')}</label><input id="sp-suma" type="number" min="0" placeholder="0"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" ${disabledAttr()} onclick="addSpalatorie()">${t('btn_add')}</button></div>
    </div>
  </div>

  <div class="add-form">
    <div class="form-title">${t('sp_filtruTitle')}</div>
    <div class="form-grid" style="grid-template-columns:minmax(0,520px) auto">
      <div class="field"><label>${t('sp_luna')}</label>${monthPicker('spalatorie', spalatorieFilter.month, DB.spalatorie.reduce((c,r)=>{ const m = r.data.slice(0,7); c[m]=(c[m]||0)+1; return c; }, {}), 'setSpalatorieMonth')}</div>
      <div class="field" style="justify-content:flex-end"><div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-ghost" onclick="setSpalatorieMonth('')">${t('sp_toatePerioadele')}</button>
        <button class="btn-primary" onclick="exportSpalatoriePdf()">${t('sp_btnRaport')}</button>
      </div></div>
    </div>
  </div>

  <div class="table-wrap">
    <div class="table-header"><div class="table-title">${rows.length} ${plural(rows.length,'sp_countSuffix')}</div><div class="table-hint">${t('sp_hint')}</div></div>
    <div class="table-scroll"><table>
      <thead><tr><th>${t('th_data')}</th><th>${t('th_participant')}</th><th>${t('sp_th_articole')}</th><th>${t('sp_th_cantitate')}</th><th>${t('sp_th_suma')}</th><th>${t('sp_th_returnare')}</th><th>${t('th_statut')}</th><th></th></tr></thead>
      <tbody>${rows.length ? rows.slice().sort((a,b)=>b.data.localeCompare(a.data)).map(r=>`
        <tr><td class="td-muted">${fmtDate(r.data)}</td><td class="td-name" ${r.participantId?`onclick="openProfile('${r.participantId}')"`:''}>${r.participantId?esc(participantName(r.participantId)):t('sp_locatia')}</td>
        <td>${esc(r.tipArticole)}</td><td class="td-muted">${r.cantitate||1}</td><td class="td-gold">${r.suma} MDL</td>
        <td class="td-muted">${r.dataReturnare?fmtDate(r.dataReturnare):'—'}</td>
        <td>${r.dataReturnare && !isFullAdmin()
          ? `<span class="badge green" title="${t('sp_lockedHint')}">${trEnum('returnat')}</span>`
          : `<button type="button" class="badge ${r.dataReturnare?'green':'yellow'}" ${disabledAttr()} onclick="toggleSpalatorieReturn('${r.id}')" title="${t('sp_hint')}">${trEnum(r.dataReturnare?'returnat':'nereturnat')}</button>`}</td>
        <td class="row-actions">${editBtn('spalatorie', r.id)}<button class="btn-danger" ${disabledAttr(true)} onclick="removeRow('spalatorie','${r.id}')">${t('btn_delete')}</button></td></tr>`).join('') : `<tr><td class="td-empty" colspan="8">${t('sp_none')}</td></tr>`}</tbody>
    </table></div>
  </div>`;
}
async function addSpalatorie(){
  const participantId = document.getElementById('sp-participant').value || null;
  const row = { data: document.getElementById('sp-data').value||todayISO(), participant_id:participantId, tip_articole: document.getElementById('sp-tip').value.trim()||'—', cantitate: Number(document.getElementById('sp-cantitate').value)||1, suma: Number(document.getElementById('sp-suma').value)||0 };
  const { data, error } = await sb.from('spalatorie').insert(row).select().single();
  if(error){ alert('Salvarea a eșuat: ' + error.message); return; }
  DB.spalatorie.unshift({id:data.id, data:data.data, participantId:data.participant_id, tipArticole:data.tip_articole, cantitate:data.cantitate, suma:Number(data.suma), dataReturnare:data.data_returnare});
  await logAction(`A înregistrat spălătorie pentru ${participantId ? participantName(participantId) : t('sp_locatia')}`);
  render();
}
async function toggleSpalatorieReturn(id){
  const item = DB.spalatorie.find(r=>r.id===id);
  if(!item) return;
  if(item.dataReturnare && !isFullAdmin()) return;
  if(!item.dataReturnare && !isFullAdmin() && !confirm(t('sp_confirmReturn'))) return;
  const dataReturnare = item.dataReturnare ? null : todayISO();
  const { data, error } = await sb.from('spalatorie').update({ data_returnare:dataReturnare }).eq('id', id).select();
  if(error){ alert('Actualizarea statutului a eșuat: ' + error.message); return; }
  if(!data || !data.length){ alert('Actualizarea a eșuat: nu aveți permisiunea necesară.'); return; }
  item.dataReturnare = dataReturnare;
  const destinatar = item.participantId ? participantName(item.participantId) : t('sp_locatia');
  await logAction(`${dataReturnare?'A marcat ca returnate':'A marcat ca nereturnate'} articolele de la spălătorie pentru ${destinatar}`);
  render();
}

/* ══════════════════════ HOSTEL ══════════════════════ */
function renderHostel(){
  const nights = {};
  DB.hostel.forEach(h=>{ nights[h.participantId]=(nights[h.participantId]||0)+1; });
  const cazatiAzi = DB.hostel.filter(h=>h.dataCazare===todayISO());
  const cazatiActivAcum = DB.hostel.filter(h=>h.statut==='activ');
  return `
  <div class="view-head"><div class="view-title">${t('ho_title')}</div></div>
  <div class="view-sub">${t('ho_sub')}</div>

  <div class="stats-row">
    <div class="stat-card"><div class="stat-label">${t('ho_cazatiAzi')}</div><div class="stat-value">${cazatiAzi.length}</div></div>
    <div class="stat-card"><div class="stat-label">${t('ho_cazatiActivAcum')}</div><div class="stat-value">${cazatiActivAcum.length}</div></div>
    <div class="stat-card"><div class="stat-label">${t('ho_totalNopti')}</div><div class="stat-value">${DB.hostel.length}</div></div>
  </div>

  <div class="add-form">
    <div class="form-title">${t('ho_addTitle')}</div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr 1.4fr auto">
      <div class="field"><label>${t('th_participant')}</label>${autocompleteField('hf-participant', participantAcOptions())}</div>
      <div class="field"><label>${t('ho_dataCazarii')}</label><input id="hf-data" type="date" value="${todayISO()}"></div>
      <div class="field"><label>${t('ho_observatii')}</label><input id="hf-obs" placeholder="${t('ho_observatiiPh')}"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" ${disabledAttr()} onclick="addHostel()">${t('btn_add')}</button></div>
    </div>
  </div>

  <div class="table-wrap">
    <div class="table-header"><div class="table-title">${t('ho_noptiTitle')}</div></div>
    <div class="table-scroll"><table><thead><tr><th>${t('th_participant')}</th><th>${t('ho_nrNopti')}</th></tr></thead><tbody>
      ${Object.entries(nights).map(([pid,c])=>`<tr><td class="td-name" onclick="openProfile('${pid}')">${esc(participantName(pid))}</td><td class="td-gold">${c}</td></tr>`).join('') || `<tr><td class="td-empty" colspan="2">${t('ho_faraDate')}</td></tr>`}
    </tbody></table></div>
  </div>

  <div class="table-wrap">
    <div class="table-header">
      <div class="table-title">${t('ho_toateCazarile')}</div>
      <div class="table-hint">${t('ho_statutHint')}</div>
    </div>
    <div class="table-scroll hostel-entries-scroll ${DB.hostel.length>10?'has-overflow':''}"><table>
      <thead><tr><th>${t('th_data')}</th><th>${t('th_participant')}</th><th>${t('ho_th_observatii')}</th><th>${t('ho_th_statut')}</th><th></th></tr></thead>
      <tbody>${DB.hostel.length ? DB.hostel.slice().sort((a,b)=>b.dataCazare.localeCompare(a.dataCazare)).map(h=>`
        <tr><td class="td-muted">${fmtDate(h.dataCazare)}</td><td class="td-name" onclick="openProfile('${h.participantId}')">${esc(participantName(h.participantId))}</td>
        <td class="td-muted">${esc(h.observatii)||'—'}</td>
        <td><button type="button" class="badge ${h.statut==='activ'?'green':'muted'}" ${disabledAttr()} onclick="toggleHostelStatus('${h.id}')">${trEnum(h.statut)}</button></td>
        <td class="row-actions">${editBtn('hostel', h.id)}<button class="btn-danger" ${disabledAttr(true)} onclick="removeRow('hostel','${h.id}')">${t('btn_delete')}</button></td></tr>`).join('') : `<tr><td class="td-empty" colspan="5">${t('ho_none')}</td></tr>`}</tbody>
    </table></div>
  </div>`;
}
async function addHostel(){
  const participantId = document.getElementById('hf-participant').value;
  if(!participantId) return;
  const row = { participant_id:participantId, data_cazare: document.getElementById('hf-data').value||todayISO(), observatii: document.getElementById('hf-obs').value.trim() || null };
  const { data, error } = await sb.from('hostel').insert(row).select().single();
  if(error){ alert('Salvarea a eșuat: ' + error.message); return; }
  DB.hostel.unshift({id:data.id, participantId:data.participant_id, dataCazare:data.data_cazare, observatii:data.observatii, statut:data.statut});
  await logAction(`A înregistrat cazare hostel pentru ${participantName(participantId)}`);
  render();
}
async function toggleHostelStatus(id){
  const item = DB.hostel.find(h=>h.id===id);
  if(!item) return;
  const statut = item.statut==='activ' ? 'închis' : 'activ';
  const { data, error } = await sb.from('hostel').update({ statut }).eq('id', id).select();
  if(error){ alert('Actualizarea statutului a eșuat: ' + error.message); return; }
  if(!data || !data.length){ alert('Actualizarea a eșuat: nu aveți permisiunea necesară.'); return; }
  item.statut = statut;
  await logAction(`A marcat cazarea lui ${participantName(item.participantId)} ca ${statut}`);
  render();
}

/* ══════════════════════ LENJERIE ══════════════════════ */
function lenjerieStockItem(source){
  return DB.inventar.find(i=>i.id===(source==='uzat'?'inv-lenjerie-uzat':'inv-lenjerie'));
}
// linen is stock-tracked only while a linen item exists in the inventory (BSKT currently has none)
function lenjerieTracked(){ return !!(lenjerieStockItem('nou') || lenjerieStockItem('uzat')); }
function lenjerieAvailable(source){
  const item = lenjerieStockItem(source);
  return item ? inventoryCurrent(item) : 0;
}
function lenjerieNoStockMessage(source){
  return t(source==='uzat'?'le_noStockUsed':'le_noStockNew');
}
function renderLenjerie(){
  const newAvailable = lenjerieAvailable('nou');
  const usedAvailable = lenjerieAvailable('uzat');
  return `
  <div class="view-head"><div class="view-title">${t('le_title')}</div></div>
  <div class="view-sub">${t('le_sub')}</div>

  <div class="add-form">
    <div class="form-title">${t('le_addTitle')}</div>
    <div class="form-grid" style="grid-template-columns:1.25fr .8fr .8fr auto">
      <div class="field"><label>${t('th_participant')}</label>${autocompleteField('lf-participant', participantAcOptions())}</div>
      <div class="field"><label>${t('le_stockSource')}</label><select id="lf-sursa"><option value="nou">${t('le_stockNew')}${lenjerieTracked() ? ` — ${newAvailable} ${t('le_available')}` : ''}</option><option value="uzat">${t('le_stockUsed')}${lenjerieTracked() ? ` — ${usedAvailable} ${t('le_available')}` : ''}</option></select></div>
      <div class="field"><label>${t('le_dataElib')}</label><input id="lf-eliberare" type="date" value="${todayISO()}"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" ${disabledAttr()} onclick="addLenjerie()">${t('btn_add')}</button></div>
    </div>
  </div>

  <div class="table-wrap">
    <div class="table-header">
      <div class="table-title">${DB.lenjerie.length} ${plural(DB.lenjerie.length,'le_countSuffix')}</div>
      <div class="table-hint">${t('le_hint')}</div>
    </div>
    <div class="table-scroll linen-list-scroll ${DB.lenjerie.length>10?'has-overflow':''}"><table>
      <thead><tr><th>${t('th_participant')}</th><th>${t('le_th_source')}</th><th>${t('le_th_eliberare')}</th><th>${t('le_th_returnare')}</th><th>${t('th_statut')}</th><th></th></tr></thead>
      <tbody>${DB.lenjerie.length ? DB.lenjerie.slice().sort((a,b)=>b.dataEliberare.localeCompare(a.dataEliberare)).map(l=>`
        <tr><td class="td-name" onclick="openProfile('${l.participantId}')">${esc(participantName(l.participantId))}</td>
        <td><span class="badge">${t(l.sursaStoc==='uzat'?'le_stockUsed':'le_stockNew')}</span></td>
        <td class="td-muted">${fmtDate(l.dataEliberare)}</td><td class="td-muted">${l.dataReturnare?fmtDate(l.dataReturnare):'—'}</td>
        <td>${l.dataReturnare && !isFullAdmin()
          ? `<span class="badge green" title="${t('le_lockedHint')}">${trEnum('returnat')}</span>`
          : `<button type="button" class="badge ${l.dataReturnare?'green':'yellow'}" ${disabledAttr()} onclick="toggleLenjerieReturn('${l.id}')" title="${t('le_hint')}">${trEnum(l.dataReturnare?'returnat':'nereturnat')}</button>`}</td>
        <td class="row-actions">${editBtn('lenjerie', l.id)}<button class="btn-danger" ${disabledAttr(true)} onclick="removeRow('lenjerie','${l.id}')">${t('btn_delete')}</button></td></tr>`).join('') : `<tr><td class="td-empty" colspan="6">${t('le_none')}</td></tr>`}</tbody>
    </table></div>
  </div>`;
}
async function addLenjerie(){
  const participantId = document.getElementById('lf-participant').value;
  if(!participantId) return;
  const sursaStoc = document.getElementById('lf-sursa').value==='uzat'?'uzat':'nou';
  if(lenjerieTracked() && lenjerieAvailable(sursaStoc)<=0){ alert(lenjerieNoStockMessage(sursaStoc)); return; }
  const row = { participant_id:participantId, data_eliberare: document.getElementById('lf-eliberare').value||todayISO(), data_returnare:null, sursa_stoc:sursaStoc };
  const { data, error } = await sb.from('lenjerie').insert(row).select().single();
  if(error){
    if(error.message && error.message.includes('LENJERIE_STOC_')) alert(lenjerieNoStockMessage(sursaStoc));
    else alert('Salvarea a eșuat: ' + error.message);
    return;
  }
  DB.lenjerie.unshift({id:data.id, participantId:data.participant_id, dataEliberare:data.data_eliberare, dataReturnare:data.data_returnare, sursaStoc:data.sursa_stoc||sursaStoc});
  await refetchInventar(); // triggerul a scăzut automat un set din sursa selectată
  await logAction(`A eliberat lenjerie pentru ${participantName(participantId)}`);
  render();
}
async function toggleLenjerieReturn(id){
  const item = DB.lenjerie.find(l=>l.id===id);
  if(!item) return;
  if(item.dataReturnare && !isFullAdmin()) return; // locked for locație — only admin can revert
  if(!item.dataReturnare && !isFullAdmin() && !confirm(t('le_confirmReturn'))) return;
  const dataReturnare = item.dataReturnare ? null : todayISO();
  const { data, error } = await sb.from('lenjerie').update({ data_returnare:dataReturnare }).eq('id', id).select();
  if(error){ alert('Actualizarea statutului a eșuat: ' + error.message); return; }
  if(!data || !data.length){ alert('Actualizarea a eșuat: nu aveți permisiunea necesară.'); return; }
  item.dataReturnare = dataReturnare;
  await refetchInventar(); // un trigger în bază a mutat stocul între nou/uzat
  await logAction(`${dataReturnare?'A marcat ca returnată':'A marcat ca nereturnată'} lenjeria lui ${participantName(item.participantId)}`);
  render();
}

/* ══════════════════════ MEDICAL ══════════════════════ */
function renderMedical(){
  const rows = medicalRows();
  return `
  <div class="view-head"><div class="view-title">${t('me_title')}</div></div>
  <div class="view-sub">${t('me_sub')}</div>

  <div class="stats-row">
    <div class="stat-card"><div class="stat-label">${t('me_faraAviz')}</div><div class="stat-value">${rows.filter(r=>r.status==='fără aviz').length}</div></div>
    <div class="stat-card crit"><div class="stat-label">${t('me_expirate')}</div><div class="stat-value c-red">${rows.filter(r=>r.status==='expirat').length}</div></div>
    <div class="stat-card warn"><div class="stat-label">${t('me_expira30')}</div><div class="stat-value c-yellow">${rows.filter(r=>r.status==='expiră curând').length}</div></div>
    <div class="stat-card"><div class="stat-label">${t('me_valabile')}</div><div class="stat-value c-green">${rows.filter(r=>r.status==='valabil').length}</div></div>
  </div>

  <div class="table-wrap">
    <div class="table-header"><div class="table-title">${t('me_tableTitle')}</div></div>
    <div class="table-scroll"><table>
      <thead><tr><th>${t('th_participant')}</th><th>${t('me_th_dataAvizului')}</th><th>${t('me_th_dataExpirarii')}</th><th>${t('me_th_zileRamase')}</th><th>${t('th_statut')}</th></tr></thead>
      <tbody>${rows.map(r=>{
        const missing = r.status==='fără aviz';
        const flag = missing ? '' : (r.zile<0 ? 'flag-red' : (r.zile<=30 ? 'flag-yellow' : ''));
        const dot = missing ? '' : (r.zile<0 ? 'red' : (r.zile<=30?'yellow':''));
        const badgeClass = missing ? 'muted' : (r.zile<0?'red':(r.zile<=30?'yellow':'green'));
        return `<tr class="${flag}">
          <td class="td-name" onclick="openProfile('${r.participantId}')">${dot?`<span class="row-flag ${dot}"></span>`:''}${esc(r.nume)}</td>
          <td class="td-muted">${fmtDate(r.dataAviz)}</td>
          <td class="td-muted">${fmtDate(r.dataExpirare)}</td>
          <td class="td-gold">${r.zile==null?'—':r.zile}</td>
          <td><span class="badge ${badgeClass}">${trEnum(r.status)}</span></td>
        </tr>`;
      }).join('') || `<tr><td class="td-empty" colspan="5">${t('me_none')}</td></tr>`}</tbody>
    </table></div>
  </div>`;
}

/* ══════════════════════ DAUNE ══════════════════════ */
let dauneFilter={mode:'month',month:todayISO().slice(0,7),year:todayISO().slice(0,4)};
function dauneMonthsAvailable(){
  const months=new Set(DB.daune.map(d=>d.data.slice(0,7)));
  months.add(todayISO().slice(0,7));
  return [...months].sort().reverse();
}
function dauneYearsAvailable(){
  const years=new Set(DB.daune.map(d=>d.data.slice(0,4)));
  years.add(todayISO().slice(0,4));
  return [...years].sort().reverse();
}
function dauneShiftMonth(yyyyMM,delta){
  const [year,month]=yyyyMM.split('-').map(Number);
  const shifted=year*12+(month-1)+delta;
  const shiftedYear=Math.floor(shifted/12);
  const shiftedMonth=shifted-shiftedYear*12+1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2,'0')}`;
}
function dauneRowsFiltered(){
  if(dauneFilter.mode==='year') return DB.daune.filter(d=>d.data.slice(0,4)===dauneFilter.year);
  const endMonth=dauneFilter.month;
  if(dauneFilter.mode==='sixMonths'){
    const startMonth=dauneShiftMonth(endMonth,-5);
    return DB.daune.filter(d=>d.data.slice(0,7)>=startMonth&&d.data.slice(0,7)<=endMonth);
  }
  return DB.daune.filter(d=>d.data.slice(0,7)===endMonth);
}
function daunePeriodLabel(){
  if(dauneFilter.mode==='year') return dauneFilter.year;
  if(dauneFilter.mode==='sixMonths') return `${monthLabel(dauneShiftMonth(dauneFilter.month,-5))} — ${monthLabel(dauneFilter.month)}`;
  return monthLabel(dauneFilter.month);
}
function dauneParticipantRanking(rows){
  const counts={};
  rows.forEach(d=>{ if(d.participantId) counts[d.participantId]=(counts[d.participantId]||0)+1; });
  return Object.entries(counts).map(([participantId,count])=>({participantId,count,name:participantName(participantId)}))
    .sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,LANG==='ru'?'ru':'ro'));
}
function damageNotifierSelect(){
  if(!isFullAdmin()){
    const active=DB.serviciuAdministratori.find(a=>a.id===currentShift?.administratorServiciuId);
    return `<select id="df-avertizor" disabled><option value="service:${active?.id||''}">${esc(active?.nume||activeShiftName())}</option></select>`;
  }
  const roster=DB.serviciuAdministratori.map(a=>`<option value="service:${a.id}">${esc(a.nume)}</option>`).join('');
  const accounts=realAdmins().map(a=>`<option value="account:${a.id}" ${a.id===currentAdminId?'selected':''}>${esc(adminName(a))}</option>`).join('');
  return `<select id="df-avertizor"><optgroup label="${esc(t('nav_serviciu'))}">${roster}</optgroup><optgroup label="${esc(t('st_admins'))}">${accounts}</optgroup></select>`;
}
function renderDaune(){
  const rows=dauneRowsFiltered();
  const ranking=dauneParticipantRanking(rows);
  const totalValoare=rows.reduce((sum,d)=>sum+Number(d.valoareEstimata||0),0);
  return `
  <div class="view-head"><div class="view-title">${t('da2_title')}</div></div>
  <div class="view-sub">${t('da2_sub')}</div>

  <div class="stats-row">
    <div class="stat-card"><div class="stat-label">${t('da2_totalValoare')}</div><div class="stat-value">${totalValoare.toLocaleString(LANG==='ru'?'ru-RU':'ro-RO')} MDL</div></div>
    <div class="stat-card"><div class="stat-label">${t('da2_totalAfectate')}</div><div class="stat-value">${rows.filter(d=>d.bunDeterioratDistrus==='afectat').length}</div></div>
    <div class="stat-card warn"><div class="stat-label">${t('da2_totalDeteriorate')}</div><div class="stat-value c-yellow">${rows.filter(d=>d.bunDeterioratDistrus==='deteriorat').length}</div></div>
  </div>

  <div class="add-form">
    <div class="form-title">${t('da2_filterMonth')}</div>
    <div class="toggle-group" role="group" aria-label="${esc(t('da2_filterMonth'))}" style="margin-bottom:14px">
      <button type="button" class="toggle-btn ${dauneFilter.mode==='month'?'active':''}" aria-pressed="${dauneFilter.mode==='month'}" onclick="dauneFilter.mode='month';render();">${t('da2_month')}</button>
      <button type="button" class="toggle-btn ${dauneFilter.mode==='sixMonths'?'active':''}" aria-pressed="${dauneFilter.mode==='sixMonths'}" onclick="dauneFilter.mode='sixMonths';render();">${t('da2_sixMonths')}</button>
      <button type="button" class="toggle-btn ${dauneFilter.mode==='year'?'active':''}" aria-pressed="${dauneFilter.mode==='year'}" onclick="dauneFilter.mode='year';render();">${t('da2_year')}</button>
    </div>
    <div class="form-grid" style="grid-template-columns:1fr">
      ${dauneFilter.mode==='year' ? `<div class="field mp-field"><label>${t('da2_year')}</label>${yearPicker(dauneFilter.year, countsByMonth(DB.daune), 'setDauneYear')}</div>`
        : `<div class="field mp-field"><label>${t(dauneFilter.mode==='sixMonths'?'da2_endMonth':'da2_month')}</label>${monthPicker('daune', dauneFilter.month, countsByMonth(DB.daune), 'setDauneMonth', { allowAll:false })}</div>`}
    </div>
  </div>

  <div class="table-wrap">
    <div class="table-header"><div><div class="table-title">${t('da2_reportTitle')}</div><div class="view-sub" style="margin:4px 0 0">${t('da2_reportSub')}</div></div><div class="table-hint">${esc(daunePeriodLabel())}</div></div>
    <div class="table-scroll"><table>
      <thead><tr><th>#</th><th>${t('th_participant')}</th><th>${t('da2_reportCount')}</th></tr></thead>
      <tbody>${ranking.length ? ranking.map((row,index)=>`<tr><td class="td-muted">${index+1}</td><td class="td-name" onclick="openProfile('${row.participantId}')">${esc(row.name)}</td><td class="td-gold">${row.count}</td></tr>`).join('') : `<tr><td class="td-empty" colspan="3">${t('da2_reportNone')}</td></tr>`}</tbody>
    </table></div>
  </div>

  <div class="add-form">
    <div class="form-title">${t('da2_addTitle')}</div>
    <div class="form-grid" style="grid-template-columns:0.8fr 1.2fr 1.2fr 0.8fr">
      <div class="field"><label>${t('th_data')}</label><input id="df-data" type="date" value="${todayISO()}"></div>
      <div class="field"><label>${t('th_participant')}</label>${autocompleteField('df-participant', participantAcOptions())}</div>
      <div class="field"><label>${t('da2_avertizor')}</label>${damageNotifierSelect()}</div>
      <div class="field"><label>${t('da2_stareBun')}</label><select id="df-stare"><option value="afectat">${t('da2_afectat')}</option><option value="deteriorat">${t('da2_deteriorat')}</option></select></div>
      <div class="field"><label>${t('da2_teren')}</label><select id="df-teren">${TERENURI.map(t2=>`<option>${esc(t2)}</option>`).join('')}</select></div>
      <div class="field"><label>${t('da2_inventarAfectat')}</label><input id="df-inventar" placeholder="${t('da2_inventarAfectatPh')}"></div>
      <div class="field"><label>${t('da2_natura')}</label><input id="df-natura" placeholder="${t('da2_naturaPh')}"></div>
      <div class="field"><label>${t('da2_valoare')}</label><input id="df-valoare" type="number" min="0" step="0.01" value="0"></div>
      <div class="field"><label>${t('da2_observatii')}</label><input id="df-observatii"></div>
      <div class="field" style="justify-content:flex-end;grid-column:4"><button class="btn-primary" ${disabledAttr()} onclick="addDauna()">${t('btn_add')}</button></div>
    </div>
  </div>

  <div class="table-wrap">
    <div class="table-header"><div class="table-title">${rows.length} ${plural(rows.length,'da2_countSuffix')}</div></div>
    <div class="table-scroll recent-actions-scroll"><table>
      <thead><tr><th>Nr.</th><th>${t('th_data')}</th><th>${t('th_participant')}</th><th>${t('da2_th_teren')}</th><th>${t('da2_th_inventarAfectat')}</th><th>${t('da2_th_natura')}</th><th>${t('da2_valoare')}</th><th>${t('da2_avertizor')}</th><th>${t('th_stare')}</th><th>${t('da2_observatii')}</th><th></th></tr></thead>
      <tbody>${rows.length ? rows.slice().sort((a,b)=>b.data.localeCompare(a.data)).map((d,idx)=>`
        <tr><td class="td-muted">${rows.length-idx}</td><td class="td-muted">${fmtDate(d.data)}</td><td class="td-name" onclick="openProfile('${d.participantId}')">${esc(participantName(d.participantId))}</td>
        <td class="td-muted">${esc(d.teren)||'—'}</td>
        <td>${esc(d.inventarAfectat)}</td><td class="td-muted">${esc(d.natura)}</td>
        <td class="td-gold">${Number(d.valoareEstimata||0).toLocaleString(LANG==='ru'?'ru-RU':'ro-RO')} MDL</td><td class="td-muted">${esc(d.avertizor)||'—'}</td>
        <td><span class="badge ${d.bunDeterioratDistrus==='deteriorat'?'yellow':'muted'}">${trEnum(d.bunDeterioratDistrus)}</span></td><td class="td-muted">${esc(d.observatii)||'—'}</td>
        <td class="row-actions">${editBtn('daune', d.id)}<button class="btn-danger" ${disabledAttr(true)} onclick="removeRow('daune','${d.id}')">${t('btn_delete')}</button></td></tr>`).join('') : `<tr><td class="td-empty" colspan="11">${t('da2_none')}</td></tr>`}</tbody>
    </table></div>
  </div>`;
}
async function addDauna(){
  const participantId = document.getElementById('df-participant').value;
  if(!participantId) return;
  const [avertizorType,avertizorId]=document.getElementById('df-avertizor').value.split(':');
  const row = {
    data: document.getElementById('df-data').value||todayISO(), participant_id:participantId,
    teren: document.getElementById('df-teren').value,
    inventar_afectat: document.getElementById('df-inventar').value.trim()||'—',
    natura: document.getElementById('df-natura').value.trim()||'—',
    stare: document.getElementById('df-stare').value,
    valoare_estimata: Number(document.getElementById('df-valoare').value||0),
    administrator_serviciu_avertizor_id: avertizorType==='service'?avertizorId:null,
    admin_avertizor_id: avertizorType==='account'?avertizorId:null,
    observatii: document.getElementById('df-observatii').value.trim()||null,
  };
  const { data, error } = await sb.from('daune').insert(row).select().single();
  if(error){ alert('Salvarea a eșuat: ' + error.message); return; }
  const avertizor=avertizorType==='service' ? DB.serviciuAdministratori.find(a=>a.id===avertizorId)?.nume : publicAdminName(DB.administratori.find(a=>a.id===avertizorId));
  DB.daune.unshift({id:data.id, data:data.data, participantId:data.participant_id, teren:data.teren, inventarAfectat:data.inventar_afectat, natura:data.natura, bunDeterioratDistrus:data.stare, observatii:data.observatii, valoareEstimata:Number(data.valoare_estimata||0), administratorServiciuAvertizorId:data.administrator_serviciu_avertizor_id, adminAvertizorId:data.admin_avertizor_id, avertizor, nrSursa:null});
  await logAction(`A înregistrat o daună provocată de ${participantName(participantId)}`);
  render();
}

/* ══════════════════════ FAIR PLAY ══════════════════════ */
let fairPlayFilter={mode:'month',month:todayISO().slice(0,7),year:todayISO().slice(0,4)};
function fairPlayMonthsAvailable(){
  const months=new Set(DB.fairPlay.map(f=>f.data.slice(0,7)));
  months.add(todayISO().slice(0,7));
  return [...months].sort().reverse();
}
function fairPlayYearsAvailable(){
  const years=new Set(DB.fairPlay.map(f=>f.data.slice(0,4)));
  years.add(todayISO().slice(0,4));
  return [...years].sort().reverse();
}
function fairPlayRowsFiltered(){
  if(fairPlayFilter.mode==='year') return DB.fairPlay.filter(f=>f.data.slice(0,4)===fairPlayFilter.year);
  const endMonth=fairPlayFilter.month;
  if(fairPlayFilter.mode==='sixMonths'){
    const startMonth=dauneShiftMonth(endMonth,-5);
    return DB.fairPlay.filter(f=>f.data.slice(0,7)>=startMonth&&f.data.slice(0,7)<=endMonth);
  }
  return DB.fairPlay.filter(f=>f.data.slice(0,7)===endMonth);
}
function fairPlayPeriodLabel(){
  if(fairPlayFilter.mode==='year') return fairPlayFilter.year;
  if(fairPlayFilter.mode==='sixMonths') return `${monthLabel(dauneShiftMonth(fairPlayFilter.month,-5))} — ${monthLabel(fairPlayFilter.month)}`;
  return monthLabel(fairPlayFilter.month);
}
function fairPlayRanking(rows){
  const counts={};
  rows.forEach(f=>{
    if(!f.participantId) return;
    const c = counts[f.participantId] || (counts[f.participantId] = Object.fromEntries(FAIRPLAY_TYPES.map(x=>[x,0])));
    c[f.tipCartonas] = (c[f.tipCartonas]||0) + 1;
  });
  const grave = c => c['fault antisportiv'] + 2*c['descalificare'];
  return Object.entries(counts).map(([participantId,c])=>({participantId, counts:c, grave:grave(c), total:FAIRPLAY_TYPES.reduce((s,x)=>s+c[x],0), name:participantName(participantId)}))
    .sort((a,b)=>b.total-a.total||b.grave-a.grave||a.name.localeCompare(b.name,LANG==='ru'?'ru':'ro'));
}
function renderFairPlay(){
  const rows=fairPlayRowsFiltered();
  const ranking=fairPlayRanking(rows);
  return `
  <div class="view-head"><div class="view-title">${t('fp_title')}</div></div>
  <div class="view-sub">${t('fp_sub')}</div>

  <div class="stats-row">
    <div class="stat-card"><div class="stat-label">${t('fp_totalSanctiuni')}</div><div class="stat-value">${rows.length}</div></div>
    ${FAIRPLAY_TYPES.map(x=>`<div class="stat-card ${x==='descalificare'?'crit':x==='fault antisportiv'?'warn':''}"><div class="stat-label">${esc(trEnum(x))}</div><div class="stat-value">${rows.filter(f=>f.tipCartonas===x).length}</div></div>`).join('')}
  </div>

  <div class="add-form">
    <div class="form-title">${t('fp_filterMonth')}</div>
    <div class="toggle-group" role="group" aria-label="${esc(t('fp_filterMonth'))}" style="margin-bottom:14px">
      <button type="button" class="toggle-btn ${fairPlayFilter.mode==='month'?'active':''}" aria-pressed="${fairPlayFilter.mode==='month'}" onclick="fairPlayFilter.mode='month';render();">${t('fp_month')}</button>
      <button type="button" class="toggle-btn ${fairPlayFilter.mode==='sixMonths'?'active':''}" aria-pressed="${fairPlayFilter.mode==='sixMonths'}" onclick="fairPlayFilter.mode='sixMonths';render();">${t('fp_sixMonths')}</button>
      <button type="button" class="toggle-btn ${fairPlayFilter.mode==='year'?'active':''}" aria-pressed="${fairPlayFilter.mode==='year'}" onclick="fairPlayFilter.mode='year';render();">${t('fp_year')}</button>
    </div>
    <div class="form-grid" style="grid-template-columns:1fr">
      ${fairPlayFilter.mode==='year' ? `<div class="field mp-field"><label>${t('fp_year')}</label>${yearPicker(fairPlayFilter.year, countsByMonth(DB.fairPlay), 'setFairPlayYear')}</div>`
        : `<div class="field mp-field"><label>${t(fairPlayFilter.mode==='sixMonths'?'fp_endMonth':'fp_month')}</label>${monthPicker('fairplay', fairPlayFilter.month, countsByMonth(DB.fairPlay), 'setFairPlayMonth', { allowAll:false })}</div>`}
    </div>
  </div>

  <div class="table-wrap">
    <div class="table-header"><div><div class="table-title">${t('fp_reportTitle')}</div><div class="view-sub" style="margin:4px 0 0">${t('fp_reportSub')}</div></div><div class="table-hint">${esc(fairPlayPeriodLabel())}</div></div>
    <div class="table-scroll"><table>
      <thead><tr><th>#</th><th>${t('th_participant')}</th>${FAIRPLAY_TYPES.map(x=>`<th>${esc(trEnum(x))}</th>`).join('')}<th>${t('fp_reportTotal')}</th></tr></thead>
      <tbody>${ranking.length ? ranking.map((row,index)=>`<tr><td class="td-muted">${index+1}</td><td class="td-name" onclick="openProfile('${row.participantId}')">${esc(row.name)}</td>${FAIRPLAY_TYPES.map(x=>`<td>${row.counts[x]?`<span class="badge ${FAIRPLAY_BADGE[x]}">${row.counts[x]}</span>`:'<span class="td-muted">0</span>'}</td>`).join('')}<td class="td-gold">${row.total}</td></tr>`).join('') : `<tr><td class="td-empty" colspan="7">${t('fp_reportNone')}</td></tr>`}</tbody>
    </table></div>
  </div>

  <div class="add-form">
    <div class="form-title">${t('fp_addTitle')}</div>
    <div class="form-grid" style="grid-template-columns:0.8fr 0.7fr 1.2fr 1fr 1.4fr 0.8fr auto">
      <div class="field"><label>${t('th_data')}</label><input id="ff-data" type="date" value="${todayISO()}"></div>
      <div class="field"><label>${t('fp_ora')}</label><input id="ff-ora" type="time"></div>
      <div class="field"><label>${t('fp_numeSportiv')}</label>${autocompleteField('ff-participant', participantAcOptions())}</div>
      <div class="field"><label>${t('fp_platou')}</label><select id="ff-platou">${TERENURI.map(tour=>`<option>${esc(tour)}</option>`).join('')}</select></div>
      <div class="field"><label>${t('fp_descriere')}</label><input id="ff-descriere" placeholder="${t('fp_descrierePh')}"></div>
      <div class="field"><label>${t('fp_cartonas')}</label><select id="ff-cartonas">${FAIRPLAY_TYPES.map(x=>`<option value="${x}">${esc(trEnum(x))}</option>`).join('')}</select></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" ${disabledAttr()} onclick="addFairPlay()">${t('btn_add')}</button></div>
    </div>
  </div>

  <div class="table-wrap">
    <div class="table-header"><div class="table-title">${DB.fairPlay.length} ${plural(DB.fairPlay.length,'fp_countSuffix')}</div></div>
    <div class="table-scroll recent-actions-scroll"><table>
      <thead><tr><th>${t('th_data')}</th><th>${t('fp_th_ora')}</th><th>${t('th_participant')}</th><th>${t('fp_th_platou')}</th><th>${t('fp_th_descriere')}</th><th>${t('fp_th_cartonas')}</th><th></th></tr></thead>
      <tbody>${DB.fairPlay.length ? DB.fairPlay.slice().sort((a,b)=>`${b.data}T${b.ora||''}`.localeCompare(`${a.data}T${a.ora||''}`)).map(f=>`
        <tr><td class="td-muted">${fmtDate(f.data)}</td><td class="td-muted">${esc(f.ora)||'—'}</td><td class="td-name" onclick="openProfile('${f.participantId}')">${esc(participantName(f.participantId))}</td>
        <td><span class="badge gold">${esc(f.platou)}</span></td><td class="td-muted">${esc(f.descriere)||'—'}</td>
        <td><span class="badge ${FAIRPLAY_BADGE[f.tipCartonas]||'muted'}">${esc(trEnum(f.tipCartonas))}</span></td>
        <td class="row-actions">${editBtn('fair_play', f.id)}<button class="btn-danger" ${disabledAttr(true)} onclick="removeRow('fair_play','${f.id}')">${t('btn_delete')}</button></td></tr>`).join('') : `<tr><td class="td-empty" colspan="7">${t('fp_none')}</td></tr>`}</tbody>
    </table></div>
  </div>`;
}
async function addFairPlay(){
  const participantId = document.getElementById('ff-participant').value;
  if(!participantId){ alert(t('fp_needSportiv')); return; }
  const row = {
    participant_id: participantId,
    data: document.getElementById('ff-data').value || todayISO(),
    ora: document.getElementById('ff-ora').value || null,
    platou: document.getElementById('ff-platou').value,
    descriere: document.getElementById('ff-descriere').value.trim() || null,
    tip_cartonas: document.getElementById('ff-cartonas').value,
  };
  const { data, error } = await sb.from('fair_play').insert(row).select().single();
  if(error){ alert('Salvarea a eșuat: ' + error.message); return; }
  DB.fairPlay.unshift({id:data.id, participantId:data.participant_id, data:data.data, ora:data.ora ? String(data.ora).slice(0,5) : '', platou:data.platou, descriere:data.descriere, tipCartonas:data.tip_cartonas, createdAt:data.created_at});
  await logAction(`A înregistrat o sancțiune (${row.tip_cartonas}) pentru ${participantName(participantId)}`);
  render();
}

/* ══════════════════════ ARBITRAJ ══════════════════════ */
function renderArbitraj(){
  return `
  <div class="view-head"><div class="view-title">${t('arb_title')}</div></div>
  <div class="view-sub">${t('arb_sub')}</div>

  ${!hasActiveShift() ? '' : `<div class="add-form">
    <div class="form-title">${t('arb_addTitle')}</div>
    <div class="form-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="field"><label>${t('pa_dulap')}</label><input id="abf-dulap" placeholder="${t('pa_dulapPh')}"></div>
      <div class="field"><label>${t('pa_nume')}</label><input id="abf-nume" placeholder="${t('pa_nume')}"></div>
      <div class="field"><label>${t('pa_prenume')}</label><input id="abf-prenume" placeholder="${t('pa_prenume')}"></div>
      <div class="field"><label>${t('pa_nastere')}</label><input id="abf-nastere" type="date"></div>
      <div class="field"><label>${t('pa_telefon')}</label><input id="abf-telefon" placeholder="${t('pa_telefonPh')}"></div>
      <div class="field"><label>${t('pa_email')}</label><input id="abf-email" placeholder="${t('pa_emailPh')}"></div>
      <div class="field"><label>${t('pa_adresa')}</label><input id="abf-adresa" placeholder="${t('pa_adresaPh')}"></div>
      <div class="field"><label>${t('pa_aviz')}</label><input id="abf-aviz" type="date" value="${todayISO()}"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" ${disabledAttr()} onclick="addArbitru()">${t('arb_btnAdd')}</button></div>
    </div>
  </div>`}

  <div class="table-wrap">
    <div class="table-header"><div class="table-title">${DB.arbitri.length} ${plural(DB.arbitri.length,'arb_countSuffix')}</div></div>
    <div class="table-scroll"><table>
      <thead><tr>${isAsistent() ? '' : `<th>${t('pa_th_dulap')}</th>`}<th>${t('pa_nume')}</th><th>${t('pa_prenume')}</th>${isAsistent() ? '' : `<th>${t('pa_th_naștere')}</th><th>${t('pa_telefon')}</th>`}<th>${t('fl_label')}</th><th>${t('th_statut')}</th></tr></thead>
      <tbody>${DB.arbitri.length ? DB.arbitri.slice().sort((a,b)=>(a.statut==='inactiv')-(b.statut==='inactiv')||a.nume.localeCompare(b.nume,'ro')||a.prenume.localeCompare(b.prenume,'ro')).map(a=>`
        <tr class="clickable" onclick="openArbitruProfile('${a.id}')">
          ${isAsistent() ? '' : `<td class="td-muted">${esc(a.nrDulap)}</td>`}<td class="td-name">${esc(a.nume)}</td><td>${esc(a.prenume)}</td>
          ${isAsistent() ? '' : `<td class="td-muted">${fmtDate(a.dataNasterii)}</td><td class="td-muted">${esc(a.telefon)}</td>`}
          <td>${freelancerBadge(a.freelancer!==false)}</td>
          <td><span class="badge ${a.statut==='activ'?'green':'muted'}">${trEnum(a.statut)}</span></td>
        </tr>`).join('') : `<tr><td class="td-empty" colspan="7">${t('arb_none')}</td></tr>`}</tbody>
    </table></div>
  </div>

  <div class="view-head"><div class="view-title">${t('ar_title')}</div></div>
  <div class="view-sub">${t('ar_sub')}</div>

  <div class="add-form">
    <div class="form-title">${t('ar_addTitle')}</div>
    <div class="form-grid" style="grid-template-columns:0.8fr 1.2fr 1fr 0.6fr 0.6fr 0.6fr auto">
      <div class="field"><label>${t('th_data')}</label><input id="af-data" type="date" value="${todayISO()}"></div>
      <div class="field"><label>${t('ar_numeArbitru')}</label><select id="af-arbitru">${arbitriActivi().map(a=>`<option>${esc(a.nume)} ${esc(a.prenume)}</option>`).join('')}</select></div>
      <div class="field"><label>${t('ar_turneu')}</label><select id="af-turneu">${TERENURI.map(tour=>`<option>${esc(tour)}</option>`).join('')}</select></div>
      <div class="field"><label>${t('ar_oraStart')}</label><input id="af-start" type="time"></div>
      <div class="field"><label>${t('ar_oraStop')}</label><input id="af-stop" type="time"></div>
      <div class="field"><label>${t('ar_mingiNoi')}</label><input id="af-mingi" type="number" min="0" value="0"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" ${disabledAttr()} onclick="addArbitraj()">${t('btn_add')}</button></div>
    </div>
    <div class="view-sub" style="margin:10px 0 0">${t('ar2_regula')(TARIF_ARBITRI.ora, TARIF_ARBITRI.retinerePct, refereeGross(TARIF_ARBITRI.ora))}</div>
    <div style="display:none">
    </div>
  </div>

  <div class="table-wrap">
    <div class="table-header"><div class="table-title">${DB.arbitraj.length} ${plural(DB.arbitraj.length,'ar_countSuffix')}</div></div>
    <div class="table-scroll recent-actions-scroll"><table>
      <thead><tr><th>${t('th_data')}</th><th>${t('ar_th_arbitru')}</th><th>${t('ar_th_turneu')}</th><th>${t('ar_interval')}</th><th class="num">${t('ar_ore')}</th><th class="num">${t('ar_th_mingiNoi')}</th><th></th></tr></thead>
      <tbody>${DB.arbitraj.length ? DB.arbitraj.slice().sort((a,b)=>b.data.localeCompare(a.data)).map(a=>{ const editing = arbitrajTimeEditId===a.id;
        return `<tr><td class="td-muted">${fmtDate(a.data)}</td><td>${esc(a.arbitru)}</td><td><span class="badge muted">${esc(a.turneu)}</span></td>
        <td>${editing ? `<span class="ar-time-edit"><input id="ae-start-${a.id}" type="time" value="${esc(a.oraStart)}"> — <input id="ae-stop-${a.id}" type="time" value="${esc(a.oraStop)}"></span>`
          : (a.oraStart&&a.oraStop ? `${esc(a.oraStart)} — ${esc(a.oraStop)}` : `<span class="td-muted">${t('ar_faraOre')}</span>`)}</td>
        <td class="num">${hoursText(refereeHours(a))}</td><td class="num td-gold">${a.cantitateMingi}</td>
        <td style="white-space:nowrap">${editing ? `<button class="btn-primary btn-sm" onclick="saveArbitrajTimes('${a.id}')">${t('btn_save')}</button> <button class="btn-ghost btn-sm" onclick="arbitrajTimeEditId=null; render();">${t('btn_cancel')}</button>`
          : `${canEditReferee(a) && !isFullAdmin() ? `<button class="btn-ghost btn-sm" onclick="arbitrajTimeEditId='${a.id}'; render();">${t('ar_editOre')}</button> ` : ''}${editBtn('arbitraj', a.id)} <button class="btn-danger btn-sm" ${disabledAttr(true)} onclick="removeRow('arbitraj','${a.id}')">${t('btn_delete')}</button>`}</td></tr>`; }).join('') : `<tr><td class="td-empty" colspan="7">${t('ar_none')}</td></tr>`}</tbody>
    </table></div>
  </div>`;
}
async function addArbitru(){
  const nume = document.getElementById('abf-nume').value.trim();
  const prenume = document.getElementById('abf-prenume').value.trim();
  if(!nume || !prenume){ alert(t('pa_needNumePrenume')); return; }
  const row = {
    nr_dulap: document.getElementById('abf-dulap').value.trim() || null,
    nume, prenume,
    data_nasterii: document.getElementById('abf-nastere').value || null,
    adresa: document.getElementById('abf-adresa').value.trim() || null,
    telefon: document.getElementById('abf-telefon').value.trim() || null,
    email: document.getElementById('abf-email').value.trim() || null,
    data_aviz_medical: document.getElementById('abf-aviz').value || null,
    statut: 'activ',
  };
  const { data, error } = await sb.from('arbitri').insert(row).select().single();
  if(error){ alert('Salvarea a eșuat: ' + error.message); return; }
  DB.arbitri.unshift({
    id:data.id, nrDulap:data.nr_dulap, nume:data.nume, prenume:data.prenume, dataNasterii:data.data_nasterii,
    adresa:data.adresa, telefon:data.telefon, email:data.email, dataAvizMedical:data.data_aviz_medical,
    statut:data.statut, dataInregistrarii:data.data_inregistrarii,
  });
  await logAction(`A înregistrat arbitru nou: ${nume} ${prenume}`);
  render();
}
function openArbitruProfile(id){
  currentArbitruId = id;
  renderArbitruProfile(false);
  openModal('arbitru-modal');
}
function renderArbitruProfile(editing = false){
  const a = arbitru(currentArbitruId); if(!a) return;
  document.getElementById('arbitru-modal-title').textContent = `${a.nume} ${a.prenume}`;
  const editBtn = document.getElementById('arbitru-edit-btn');
  editBtn.style.display = (editing || !hasActiveShift()) ? 'none' : '';
  editBtn.title = t('arb_editTitle');
  const deleteBtn = document.getElementById('arbitru-delete-btn');
  deleteBtn.style.display = (editing || !isFullAdmin()) ? 'none' : '';
  deleteBtn.title = t('arb_deleteTitle');

  if(editing){
    document.getElementById('arbitru-modal-body').innerHTML = `
      <div class="profile-edit-grid">
        <div class="field"><label>${t('pa_dulap')}</label><input id="eab-dulap" value="${esc(a.nrDulap)}" placeholder="${t('pa_dulapPh')}"></div>
        <div class="field"><label>${t('th_statut')}</label><select id="eab-statut">
          <option value="activ" ${a.statut==='activ'?'selected':''}>${trEnum('activ')}</option>
          <option value="inactiv" ${a.statut==='inactiv'?'selected':''}>${trEnum('inactiv')}</option>
        </select></div>
        <div class="field"><label>${t('fl_label')}</label><select id="eab-freelancer">
          <option value="1" ${a.freelancer!==false?'selected':''}>${t('fl_daLung')}</option>
          <option value="0" ${a.freelancer===false?'selected':''}>${t('fl_nuLung')}</option></select></div>
        <div class="field"><label>${t('pa_nume')}</label><input id="eab-nume" value="${esc(a.nume)}"></div>
        <div class="field"><label>${t('pa_prenume')}</label><input id="eab-prenume" value="${esc(a.prenume)}"></div>
        <div class="field"><label>${t('pa_nastere')}</label><input id="eab-nastere" type="date" value="${esc(a.dataNasterii)}"></div>
        <div class="field"><label>${t('pa_telefon')}</label><input id="eab-telefon" value="${esc(a.telefon)}"></div>
        <div class="field"><label>${t('pa_email')}</label><input id="eab-email" type="email" value="${esc(a.email)}"></div>
        <div class="field"><label>${t('pa_adresa')}</label><input id="eab-adresa" value="${esc(a.adresa)}"></div>
        <div class="field"><label>${t('fi_idnp')}</label><input id="eab-idnp" inputmode="numeric" maxlength="13" value="${esc(a.idnp)}"></div>
        <div class="field"><label>${t('fi_nrAct')}</label><input id="eab-nract" value="${esc(a.nrAct)}"></div>
        <div class="field"><label>${t('fi_dataEmiterii')}</label><input id="eab-emis" type="date" value="${esc(a.dataEmiteriiAct)}"></div>
        <div class="field"><label>${t('pa_aviz')}</label><input id="eab-aviz" type="date" value="${esc(a.dataAvizMedical)}"></div>
      </div>
      <div class="profile-edit-actions">
        <button class="btn-ghost" onclick="renderArbitruProfile(false)">${t('btn_cancel')}</button>
        <button class="btn-primary" onclick="saveArbitruProfile()">${t('btn_save')}</button>
      </div>`;
    return;
  }

  if(isAsistent()){
    document.getElementById('arbitru-modal-body').innerHTML = `
    <div class="profile-grid">
      <div><div class="k">${t('th_statut')}</div><div class="v"><span class="badge ${a.statut==='activ'?'green':'muted'}">${trEnum(a.statut)}</span></div></div>
      <div><div class="k">${t('fl_label')}</div><div class="v">${freelancerBadge(a.freelancer!==false)}</div></div>
      <div><div class="k">${t('as_arbInregistrat')}</div><div class="v">${fmtDate(a.dataInregistrarii)}</div></div>
    </div>
    <div class="view-sub" style="margin:14px 0 0">${t('as_arbDatePersonale')}</div>`;
    return;
  }
  document.getElementById('arbitru-modal-body').innerHTML = `
    <div class="profile-grid">
      <div><div class="k">${t('pa_dulap')}</div><div class="v">${esc(a.nrDulap)||'—'}</div></div>
      <div><div class="k">${t('th_statut')}</div><div class="v"><span class="badge ${a.statut==='activ'?'green':'muted'}">${trEnum(a.statut)}</span></div></div>
      <div><div class="k">${t('fl_label')}</div><div class="v">${freelancerBadge(a.freelancer!==false)}</div></div>
      <div><div class="k">${t('pa_nastere')}</div><div class="v">${fmtDate(a.dataNasterii)}</div></div>
      <div><div class="k">${t('pa_adresa')}</div><div class="v">${esc(a.adresa)||'—'}</div></div>
      <div><div class="k">${t('fi_idnp')}</div><div class="v">${esc(a.idnp)||'—'}</div></div>
      <div><div class="k">${t('fi_nrAct')}</div><div class="v">${esc(a.nrAct)||'—'}${a.dataEmiteriiAct?` <span class="td-muted">· ${fmtDate(a.dataEmiteriiAct)}</span>`:''}</div></div>
      <div><div class="k">${t('pa_telefon')}</div><div class="v">${esc(a.telefon)||'—'}</div></div>
      <div><div class="k">${t('pa_email')}</div><div class="v">${esc(a.email)||'—'}</div></div>
      <div><div class="k">${t('pa_aviz')}</div><div class="v">${fmtDate(a.dataAvizMedical)||'—'}</div></div>
    </div>`;
}
async function saveArbitruProfile(){
  const a = arbitru(currentArbitruId); if(!a) return;
  const nume = document.getElementById('eab-nume').value.trim();
  const prenume = document.getElementById('eab-prenume').value.trim();
  if(!nume || !prenume){ alert(t('pa_needNumePrenume2')); return; }
  const row = {
    nr_dulap: document.getElementById('eab-dulap').value.trim() || null,
    nume, prenume,
    data_nasterii: document.getElementById('eab-nastere').value || null,
    telefon: document.getElementById('eab-telefon').value.trim() || null,
    email: document.getElementById('eab-email').value.trim() || null,
    adresa: document.getElementById('eab-adresa').value.trim() || null,
    idnp: document.getElementById('eab-idnp').value.trim() || null,
    nr_act: document.getElementById('eab-nract').value.trim().toUpperCase() || null,
    data_emiterii_act: document.getElementById('eab-emis').value || null,
    data_aviz_medical: document.getElementById('eab-aviz').value || null,
    statut: document.getElementById('eab-statut').value,
    freelancer: document.getElementById('eab-freelancer').value==='1',
  };
  const saveBtn = document.querySelector('#arbitru-modal-body .btn-primary');
  if(saveBtn){ saveBtn.disabled = true; saveBtn.textContent = t('btn_saving'); }
  const { data, error } = await sb.from('arbitri').update(row).eq('id', a.id).select().single();
  if(error){
    alert('Actualizarea a eșuat: ' + error.message);
    if(saveBtn){ saveBtn.disabled = false; saveBtn.textContent = t('btn_save'); }
    return;
  }
  Object.assign(a, {
    nrDulap:data.nr_dulap, nume:data.nume, prenume:data.prenume, dataNasterii:data.data_nasterii,
    adresa:data.adresa, telefon:data.telefon, email:data.email, dataAvizMedical:data.data_aviz_medical,
    statut:data.statut, freelancer:data.freelancer!==false, idnp:data.idnp, nrAct:data.nr_act, dataEmiteriiAct:data.data_emiterii_act,
  });
  await logAction(`A actualizat profilul arbitrului ${data.nume} ${data.prenume}`);
  render();
  renderArbitruProfile(false);
}
async function deleteArbitru(){
  const a = arbitru(currentArbitruId); if(!a) return;
  const nume = `${a.nume} ${a.prenume}`;
  if(!confirm(t('arb_deleteConfirm')(nume))) return;
  const { data, error } = await sb.from('arbitri').delete().eq('id', a.id).select();
  if(error){ alert('Ștergerea a eșuat: ' + error.message); return; }
  if(!data || !data.length){ alert('Ștergerea a eșuat: nu aveți permisiunea necesară.'); return; }
  await logAction(`A șters arbitrul ${nume}`);
  closeModal('arbitru-modal');
  await fetchAll();
  render();
}
let arbitrajTimeEditId = null;
function canEditReferee(a){ return isFullAdmin() || (!!currentShift && a.sesiuneSchimbId===currentShift.id); }
async function saveArbitrajTimes(id){
  const a = DB.arbitraj.find(x=>x.id===id); if(!a) return;
  const ora_start = document.getElementById(`ae-start-${id}`).value || null, ora_stop = document.getElementById(`ae-stop-${id}`).value || null;
  if((ora_start && !ora_stop) || (!ora_start && ora_stop)){ alert(t('ar_needAmbeleOre')); return; }
  const { data, error } = await sb.from('arbitraj').update({ ora_start, ora_stop }).eq('id', id).select();
  if(error || !data?.length){ alert(t('err_update')+' '+(error?.message||t('err_noPerm'))); return; }
  a.oraStart = ora_start||''; a.oraStop = ora_stop||''; arbitrajTimeEditId = null;
  await logAction(`A înregistrat orele arbitrului ${a.arbitru} pe ${fmtDate(a.data)}: ${ora_start||'—'}–${ora_stop||'—'}`);
  render();
}
async function addArbitraj(){
  const arbitru = document.getElementById('af-arbitru').value.trim();
  if(!arbitru){ alert(t('ar_needNume')); return; }
  const dayChk = document.getElementById('af-data').value || todayISO();
  const ora_start = document.getElementById('af-start').value || null, ora_stop = document.getElementById('af-stop').value || null;
  if((ora_start && !ora_stop) || (!ora_start && ora_stop)){ alert(t('ar_needAmbeleOre')); return; }
  const turneu = document.getElementById('af-turneu').value;
  const cantitateMingiRaw = parseInt(document.getElementById('af-mingi').value);
  const cantitateMingi = Number.isFinite(cantitateMingiRaw) && cantitateMingiRaw>=0 ? cantitateMingiRaw : 0;
  const data = document.getElementById('af-data').value || todayISO();
  const { data:row, error } = await sb.from('arbitraj').insert({ data, arbitru, turneu, cantitate_mingi:cantitateMingi, ...(ora_start ? { ora_start, ora_stop } : {}) }).select().single();
  if(error){ alert('Salvarea a eșuat: ' + error.message); return; }
  DB.arbitraj.unshift({id:row.id, data:row.data, arbitru:row.arbitru, turneu:row.turneu, cantitateMingi:row.cantitate_mingi, oraStart:row.ora_start?String(row.ora_start).slice(0,5):'', oraStop:row.ora_stop?String(row.ora_stop).slice(0,5):'', observatii:row.observatii});
  await refetchInventar(); // trigger a scăzut deja mingile din stoc
  await logAction(`A eliberat ${cantitateMingi} mingi lui ${arbitru} (${turneu})`);
  render();
}

/* ══════════════════════ ANTRENAMENTE ══════════════════════ */
let antrenamenteFilter = { month:'' };
function eligibleTrainingParticipants(){
  return DB.participanti.filter(p=>p.eligibilAntrenament).sort((a,b)=>a.nume.localeCompare(b.nume,'ro')||a.prenume.localeCompare(b.prenume,'ro'));
}
function antrenamenteMonthsAvailable(){
  const months = new Set(DB.treninguri.map(r=>r.data.slice(0,7)));
  months.add(todayISO().slice(0,7));
  return [...months].sort().reverse();
}
function trainingSessionsFiltered(){
  const m = antrenamenteFilter.month;
  return DB.treninguri.filter(r => !m || r.data.slice(0,7)===m);
}
// Trainer columns follow the fixed TRAINERS order, but historic rows may name a trainer
// who is no longer on the list — keep those as trailing columns so no money goes missing.
function trainingTrainerColumns(rows){
  const extra = [...new Set(rows.map(r=>r.antrenor).filter(a=>a && !TRAINERS.includes(a)))].sort();
  return [...TRAINERS, ...extra];
}
function trainingPlayerTotals(rows=trainingSessionsFiltered()){
  const byPlayer = new Map();
  rows.forEach(r=>{
    let entry = byPlayer.get(r.participantId);
    if(!entry){
      entry = { participantId:r.participantId, nume:participantName(r.participantId), sesiuni:0, total:0, perAntrenor:{} };
      byPlayer.set(r.participantId, entry);
    }
    const suma = Number(r.sumaJucator||0);
    entry.sesiuni += 1;
    entry.total += suma;
    entry.perAntrenor[r.antrenor] = (entry.perAntrenor[r.antrenor]||0) + suma;
  });
  return [...byPlayer.values()].sort((a,b)=> b.total-a.total || a.nume.localeCompare(b.nume,'ro'));
}
async function exportAntrenamentePdf(){
  if(!window.jspdf?.jsPDF){ alert(t('re_noPdf')); return; }
  const rows = trainingSessionsFiltered();
  const totals = trainingPlayerTotals(rows);
  if(!totals.length){ alert(t('an_raportNimic')); return; }
  const trainers = trainingTrainerColumns(rows);
  // Past ~4 trainer columns the player name gets squeezed unreadably on A4 portrait, so widen the page instead.
  const orientation = trainers.length > 4 ? 'landscape' : 'portrait';
  const doc = new window.jspdf.jsPDF({ orientation });
  try { await ensurePdfFont(doc); } catch(e){ alert('Fontul PDF nu s-a putut incarca: ' + e.message); return; }

  const perioada = antrenamenteFilter.month ? monthLabel(antrenamenteFilter.month) : t('an_raportToate');
  const totalGeneral = totals.reduce((s,r)=>s+r.total,0);
  const totalSesiuni = totals.reduce((s,r)=>s+r.sesiuni,0);

  doc.setFont('NotoSans','bold'); doc.setFontSize(15); doc.setTextColor(35,42,52);
  doc.text(t('an_raportTitlu'), 12, 15);
  doc.setFont('NotoSans','normal'); doc.setFontSize(9); doc.setTextColor(85);
  doc.text(`${t('an_raportPerioada')}: ${perioada}`, 12, 21.5);
  doc.text(`${t('an_raportJucatoriDistincti')}: ${totals.length}   ·   ${t('an_totalSesiuni')}: ${totalSesiuni}   ·   ${t('an_totalIncasat')}: ${totalGeneral} MDL`, 12, 26.5);
  doc.text(`${t('an_raportGenerat')}: ${fmtDate(moldovaClock().dateKey)}`, 12, 31.5);

  // Give the fixed columns their due, reserve a legible minimum for the name, then let the
  // trainer columns absorb whatever is left — never let the total exceed the printable width.
  const usable = doc.internal.pageSize.getWidth() - 24;
  const wNr = 11, wSesiuni = 16, wTotal = 30, minJucator = 45;
  const flexible = usable - wNr - wSesiuni - wTotal;
  const wTrainer = Math.min(24, (flexible - minJucator) / trainers.length);
  const wJucator = flexible - wTrainer*trainers.length;
  const columnStyles = { 0:{cellWidth:wNr, halign:'center'}, 1:{cellWidth:wJucator} , 2:{cellWidth:wSesiuni, halign:'center'} };
  trainers.forEach((_,i)=>{ columnStyles[3+i] = { cellWidth:wTrainer, halign:'right' }; });
  columnStyles[3+trainers.length] = { cellWidth:wTotal, halign:'right', fontStyle:'bold' };

  doc.autoTable({
    startY:36,
    head:[[t('an_raportTh_nr'), t('an_raportTh_jucator'), t('an_raportTh_sesiuni'), ...trainers, t('an_raportTh_total')]],
    body: totals.map((r,i)=>[
      i+1, pdfCell(r.nume), r.sesiuni,
      ...trainers.map(tr=> r.perAntrenor[tr] ? `${r.perAntrenor[tr]}` : '-'),
      `${r.total}`,
    ]),
    foot:[[
      '', t('an_raportTotalGeneral'), totalSesiuni,
      ...trainers.map(()=> ''),
      `${totalGeneral}`,
    ]],
    theme:'grid',
    margin:{left:12,right:12,top:12,bottom:12},
    styles:{font:'NotoSans', fontSize:8.2, cellPadding:2.1, lineColor:[205,210,218], lineWidth:.15, overflow:'linebreak'},
    headStyles:{font:'NotoSans', fontStyle:'bold', fillColor:[55,65,81], textColor:255, cellPadding:2.4, halign:'center'},
    footStyles:{font:'NotoSans', fontStyle:'bold', fillColor:[232,235,240], textColor:[35,42,52], cellPadding:2.4},
    alternateRowStyles:{fillColor:[247,249,251]},
    columnStyles,
    rowPageBreak:'avoid',
    showFoot:'lastPage', // a grand total repeated on every page reads like a page subtotal
    didParseCell:d=>{ if(d.section==='foot' && d.column.index>=2) d.cell.styles.halign = 'right'; },
  });
  doc.save(`antrenamente_jucatori_${antrenamenteFilter.month || 'total'}.pdf`);
}
function renderAntrenamente(){
  const rows = trainingSessionsFiltered();
  const totalIncasat = rows.reduce((s,r)=>s+Number(r.sumaJucator||0),0);
  const perAntrenor = TRAINERS.map(tr=>({
    antrenor: tr,
    sesiuni: rows.filter(r=>r.antrenor===tr).length,
    suma: rows.filter(r=>r.antrenor===tr).reduce((s,r)=>s+Number(r.sumaAntrenor||0),0),
  }));
  const eligibili = eligibleTrainingParticipants();
  const neeligibili = DB.participanti.filter(p=>p.statut==='activ' && !p.eligibilAntrenament).sort((a,b)=>a.nume.localeCompare(b.nume,'ro')||a.prenume.localeCompare(b.prenume,'ro'));
  return `
  <div class="view-head"><div class="view-title">${t('an_title')}</div></div>
  <div class="view-sub">${t('an_sub')}</div>

  <div class="add-form">
    <div class="form-title">${t('an_perioada')}</div>
    <div class="form-grid" style="grid-template-columns:minmax(0,520px) auto">
      <div class="field"><label>${t('an_luna')}</label>${monthPicker('antrenamente', antrenamenteFilter.month, countsByMonth(DB.treninguri), 'setAntrenamenteMonth')}</div>
      <div class="field" style="justify-content:flex-end"><div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-ghost" onclick="setAntrenamenteMonth('')">${t('an_toateLunile')}</button>
        <button class="btn-primary" onclick="exportAntrenamentePdf()">${t('an_btnRaportJucatori')}</button>
      </div></div>
    </div>
  </div>

  <div class="stats-row">
    <div class="stat-card"><div class="stat-label">${t('an_totalSesiuni')}</div><div class="stat-value">${rows.length}</div></div>
    <div class="stat-card"><div class="stat-label">${t('an_totalIncasat')}</div><div class="stat-value">${totalIncasat} MDL</div></div>
    ${perAntrenor.map(p=>`<div class="stat-card"><div class="stat-label">${esc(p.antrenor)}</div><div class="stat-value">${p.suma} MDL</div><div class="stat-sub">${p.sesiuni} ${plural(p.sesiuni,'an_countSuffix')}</div></div>`).join('')}
  </div>

  <div class="add-form">
    <div class="form-title">${t('an_addTitle')}</div>
    <div class="form-grid" style="grid-template-columns:1.2fr 0.8fr 0.8fr 0.7fr auto">
      <div class="field"><label>${t('an_jucator')}</label>${autocompleteField('tf-jucator', eligibili.map(p=>({value:p.id, label:`${p.nume} ${p.prenume}`})))}</div>
      <div class="field"><label>${t('an_antrenor')}</label><select id="tf-antrenor">${TRAINERS.map(tr=>`<option>${esc(tr)}</option>`).join('') || `<option value="">${t('stx_faraAntrenori')}</option>`}</select></div>
      <div class="field"><label>${t('th_data')}</label><input id="tf-data" type="date" value="${todayISO()}"></div>
      <div class="field"><label>${t('an_ora')}</label><input id="tf-ora" type="time"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" ${disabledAttr()} onclick="addTraining()">${t('an_btnAdd')}</button></div>
    </div>
  </div>

  <div class="table-wrap">
    <div class="table-header"><div class="table-title">${Math.min(rows.length,30)} ${plural(Math.min(rows.length,30),'an_countSuffix')}</div></div>
    <div class="table-scroll recent-actions-scroll"><table>
      <thead><tr><th>${t('th_data')}</th><th>${t('an_th_jucator')}</th><th>${t('an_th_antrenor')}</th><th>${t('an_th_ora')}</th><th>${t('an_th_sumaJucator')}</th><th>${t('an_th_sumaAntrenor')}</th><th></th></tr></thead>
      <tbody>${rows.length ? rows.slice().sort((a,b)=>b.data.localeCompare(a.data)).slice(0,30).map(r=>`
        <tr><td class="td-muted">${fmtDate(r.data)}</td><td class="td-name" onclick="openProfile('${r.participantId}')">${esc(participantName(r.participantId))}</td>
        <td>${esc(r.antrenor)}</td><td class="td-muted">${r.ora ? String(r.ora).slice(0,5) : '—'}</td>
        <td class="td-gold">${r.sumaJucator} MDL</td><td class="td-gold">${r.sumaAntrenor} MDL</td>
        <td class="row-actions">${editBtn('treninguri', r.id)}<button class="btn-danger" ${disabledAttr(true)} onclick="removeRow('treninguri','${r.id}')">${t('btn_delete')}</button></td></tr>`).join('') : `<tr><td class="td-empty" colspan="7">${t('an_none')}</td></tr>`}</tbody>
    </table></div>
  </div>

  ${hasActiveShift() ? `<div class="add-form">
    <div class="form-title">${t('an_eligibiliTitle')}</div>
    <div class="view-sub" style="margin:-4px 0 14px">${t('an_eligibiliSub')}</div>
    <div class="form-grid" style="grid-template-columns:1fr auto">
      <div class="field"><label>${t('an_adaugaEligibil')}</label>${autocompleteField('tf-add-eligibil', neeligibili.map(p=>({value:p.id, label:`${p.nume} ${p.prenume}`})))}</div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" ${disabledAttr()} onclick="addEligibleParticipant()">${t('an_eligibilAdaugat')}</button></div>
    </div>
    <div class="mini-list" style="margin-top:14px">
      ${eligibili.length ? eligibili.map(p=>`<div class="mini-row"><span class="td-name" onclick="openProfile('${p.id}')">${esc(p.nume)} ${esc(p.prenume)}</span>${isFullAdmin()?`<button class="btn-danger" onclick="removeEligibleParticipant('${p.id}')">${t('btn_delete')}</button>`:''}</div>`).join('') : `<div class="mini-empty">${t('an_eligibilNone')}</div>`}
    </div>
  </div>` : ''}`;
}
async function addTraining(){
  const participantId = document.getElementById('tf-jucator').value;
  if(!participantId){ alert(t('an_needJucator')); return; }
  const antrenor = document.getElementById('tf-antrenor').value;
  const data = document.getElementById('tf-data').value || todayISO();
  const ora = document.getElementById('tf-ora').value || null;
  const row = { participant_id:participantId, antrenor, data, ora, suma_jucator:TRAINING_SUMA_JUCATOR, suma_antrenor:TRAINING_SUMA_ANTRENOR };
  const { data:saved, error } = await sb.from('treninguri').insert(row).select().single();
  if(error){ alert('Salvarea a eșuat: ' + error.message); return; }
  DB.treninguri.unshift({id:saved.id, participantId:saved.participant_id, antrenor:saved.antrenor, data:saved.data, ora:saved.ora, sumaJucator:Number(saved.suma_jucator), sumaAntrenor:Number(saved.suma_antrenor), observatii:saved.observatii});
  await logAction(`A înregistrat un antrenament pentru ${participantName(participantId)} cu ${antrenor}`);
  render();
}
async function addEligibleParticipant(){
  const id = document.getElementById('tf-add-eligibil').value;
  if(!id) return;
  const { data, error } = await sb.from('participanti').update({ eligibil_antrenament:true }).eq('id', id).select();
  if(error){ alert('Actualizarea a eșuat: ' + error.message); return; }
  if(!data || !data.length){ alert('Actualizarea a eșuat: nu aveți permisiunea necesară.'); return; }
  const p = participant(id); if(p) p.eligibilAntrenament = true;
  await logAction(`A adăugat ${participantName(id)} la lista de eligibilitate pentru antrenamente`);
  render();
}
async function removeEligibleParticipant(id){
  const { data, error } = await sb.from('participanti').update({ eligibil_antrenament:false }).eq('id', id).select();
  if(error){ alert('Actualizarea a eșuat: ' + error.message); return; }
  if(!data || !data.length){ alert('Actualizarea a eșuat: nu aveți permisiunea necesară.'); return; }
  const p = participant(id); if(p) p.eligibilAntrenament = false;
  await logAction(`A eliminat ${participantName(id)} din lista de eligibilitate pentru antrenamente`);
  render();
}

/* ══════════════════════ INVENTAR ══════════════════════ */
let inventarAddState = { tip:'intrare', coloana:'intrare' };
function renderInventar(){
  if(!isFullAdmin()) inventarAddState.tip = 'intrare';
  const showColoana = isFullAdmin() && inventarAddState.tip==='corectare';
  return `
  <div class="view-head"><div class="view-title">${t('iv_title')}</div></div>
  <div class="view-sub">${t('iv_sub')}</div>

  ${lowStockItems().length ? `<div class="locked-banner" style="border-color:rgba(210,166,74,.4)">${icon('alert')} ${lowStockItems().length} ${plural(lowStockItems().length,'iv_lowStock')}</div>` : ''}

  <div class="add-form">
    <div class="form-title">${t('iv_addTitle')}</div>
    <div class="form-grid" style="grid-template-columns:1.4fr 0.8fr ${showColoana?'0.8fr ':''}0.8fr auto">
      <div class="field"><label>${t('iv_articol')}</label><select id="if2-item">
        <optgroup label="${esc(t('iv_structTitle'))}">${inventarSorted(DB.inventar.filter(i=>i.conditie!=='uzat')).map(i=>`<option value="${i.id}">${esc(trEnum(i.denumire))}${i.marime!=='—'?' — '+i.marime:''}</option>`).join('')}</optgroup>
        <optgroup label="${esc(t('iv_uzateTitle'))}">${inventarSorted(DB.inventar.filter(i=>i.conditie==='uzat')).map(i=>`<option value="${i.id}">${esc(trEnum(i.denumire))}${i.marime!=='—'?' — '+i.marime:''}</option>`).join('')}</optgroup>
      </select></div>
      <div class="field"><label>${t('iv_tipMiscare')}</label><select id="if2-tip" onchange="inventarAddState.tip=this.value; render();">
        <option value="intrare" ${inventarAddState.tip==='intrare'?'selected':''}>${t('iv_intrare')}</option>
        ${isFullAdmin() ? `<option value="iesire" ${inventarAddState.tip==='iesire'?'selected':''}>${t('iv_iesire')}</option>
        <option value="corectare" ${inventarAddState.tip==='corectare'?'selected':''}>${t('iv_corectare')}</option>` : ''}
      </select></div>
      ${showColoana ? `<div class="field"><label>${t('iv_coloana')}</label><select id="if2-coloana" onchange="inventarAddState.coloana=this.value;">
        <option value="intrare" ${inventarAddState.coloana==='intrare'?'selected':''}>${t('iv_intrare')}</option>
        <option value="iesire" ${inventarAddState.coloana==='iesire'?'selected':''}>${t('iv_iesire')}</option>
      </select></div>` : ''}
      <div class="field"><label>${t('ve_cantitate')}</label><input id="if2-cant" type="number" min="1" value="1"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" ${disabledAttr()} onclick="adjustInventory()">${t('iv_btnAdd')}</button></div>
    </div>
  </div>

  <div class="table-wrap">
    <div class="table-header"><div class="table-title">${t('iv_structTitle')}</div></div>
    <div class="table-scroll"><table>
      <thead><tr><th>${t('iv_th_articol')}</th><th>${t('iv_th_culoare')}</th><th>${t('iv_th_marime')}</th><th>${t('iv_th_um')}</th><th>${t('iv_th_initial')}</th><th>${t('iv_th_intrari')}</th><th>${t('iv_th_iesiri')}</th><th>${t('iv_th_curent')}</th><th>${t('iv_th_minim')}</th><th>${t('iv_th_stare')}</th>${isFullAdmin()?'<th></th>':''}</tr></thead>
      <tbody>${inventarRows(inventarSorted(DB.inventar.filter(i=>i.conditie!=='uzat')))}</tbody>
    </table></div>
  </div>

  ${DB.inventar.some(i=>i.conditie==='uzat') ? `<div class="view-head"><div class="view-title">${t('iv_uzateTitle')}</div></div>
  <div class="view-sub">${t('iv_uzateSub')}</div>

  <div class="table-wrap">
    <div class="table-header"><div class="table-title">${t('iv_uzateTitle')}</div></div>
    <div class="table-scroll"><table>
      <thead><tr><th>${t('iv_th_articol')}</th><th>${t('iv_th_culoare')}</th><th>${t('iv_th_marime')}</th><th>${t('iv_th_um')}</th><th>${t('iv_th_initial')}</th><th>${t('iv_th_intrari')}</th><th>${t('iv_th_iesiri')}</th><th>${t('iv_th_curent')}</th>${isFullAdmin()?'<th></th>':''}</tr></thead>
      <tbody>${inventarRows(inventarSorted(DB.inventar.filter(i=>i.conditie==='uzat')), {minim:false})}</tbody>
    </table></div>
  </div>` : ''}`;
}
function inventarRows(items, opts){
  const showMinim = !opts || opts.minim !== false;
  return items.map(i=>{
    const curent = inventoryCurrent(i);
    const low = showMinim && curent < i.cantitateMinima;
    const stare = inventoryStare(curent, i.cantitateMinima);
    const stareBadge = stare==='bună' ? 'green' : stare==='minim' ? 'yellow' : stare==='sub minim' ? 'amber' : 'red';
    return `<tr class="${low?'flag-yellow':''}">
      <td class="td-name">${low?'<span class="row-flag yellow"></span>':''}${esc(trEnum(i.denumire))}</td>
      <td class="td-muted">${esc(trEnum(i.culoare))}</td>
      <td>${i.marime && i.marime!=='—' ? `<span class="inventory-size">${esc(i.marime)}</span>` : '<span class="td-muted">—</span>'}</td>
      <td class="td-muted">${esc(i.um)}</td>
      <td class="td-muted">${i.cantitateInitiala}</td><td class="td-muted">${i.intrari}</td><td class="td-muted">${i.iesiri}</td>
      <td class="td-gold">${curent}</td>${showMinim ? `<td class="td-muted">${i.cantitateMinima}</td>
      <td><span class="badge ${stareBadge}">${esc(trEnum(stare))}</span></td>` : ''}
      ${isFullAdmin() ? `<td class="row-actions">${editBtn('inventar', i.id)}</td>` : ''}
    </tr>`;
  }).join('');
}
async function adjustInventory(){
  const id = document.getElementById('if2-item').value;
  const tip = inventarAddState.tip;
  const cant = parseInt(document.getElementById('if2-cant').value)||1;
  const item = DB.inventar.find(i=>i.id===id); if(!item) return;

  let rpcError, logMsg;
  if(tip==='intrare'){
    ({ error: rpcError } = await sb.rpc('inventar_log_intrare', { p_inventar_id:id, p_cantitate:cant, p_motiv:'Ajustare manuală din pagina Inventar' }));
    logMsg = `A înregistrat o intrare de ${cant} ${item.um} — ${item.denumire}`;
  } else if(tip==='iesire'){
    ({ error: rpcError } = await sb.rpc('inventar_log_iesire', { p_inventar_id:id, p_cantitate:cant, p_motiv:'Ajustare manuală din pagina Inventar' }));
    logMsg = `A înregistrat o ieșire de ${cant} ${item.um} — ${item.denumire}`;
  } else {
    const coloana = inventarAddState.coloana;
    ({ error: rpcError } = await sb.rpc('inventar_log_corectie', { p_inventar_id:id, p_coloana:coloana, p_cantitate:cant, p_motiv:'Corecție manuală din pagina Inventar' }));
    logMsg = `A corectat ${coloana==='intrare'?'intrările':'ieșirile'} cu -${cant} ${item.um} — ${item.denumire}`;
  }
  if(rpcError){ alert('Actualizarea a eșuat: ' + rpcError.message); return; }
  await refetchInventar();
  await logAction(logMsg);
  render();
}

/* ══════════════════════ SARCINI ══════════════════════ */
function taskAdministratorSelect(){
  if(!isFullAdmin()){
    const active = DB.serviciuAdministratori.find(a=>a.id===currentShift?.administratorServiciuId);
    return `<select id="taf-admin" disabled><option value="service:${active?.id||''}">${esc(active?.nume||activeShiftName())}</option></select>`;
  }
  const roster = DB.serviciuAdministratori.map(a=>`<option value="service:${a.id}">${esc(a.nume)}</option>`).join('');
  const accounts = realAdmins().map(a=>`<option value="account:${a.id}" ${a.id===currentAdminId?'selected':''}>${esc(adminName(a))}</option>`).join('');
  return `<select id="taf-admin"><optgroup label="${esc(t('nav_serviciu'))}">${roster}</optgroup><optgroup label="${esc(t('st_admins'))}">${accounts}</optgroup></select>`;
}
const TASK_STATUS_ORDER = ['nesoluționat','în lucru','soluționat'];
const TASK_STATUS_SLUG = { 'nesoluționat':'nesolutionat', 'în lucru':'inlucru', 'soluționat':'solutionat' };
let taskFilter = 'all';
function setTaskFilter(filter){
  taskFilter = ['all','open','solved'].includes(filter) ? filter : 'all';
  render();
}
function sarciniFiltered(){
  if(taskFilter==='open') return DB.sarcini.filter(s=>s.status==='nesoluționat' || s.status==='în lucru');
  if(taskFilter==='solved') return DB.sarcini.filter(s=>s.status==='soluționat');
  return DB.sarcini.slice();
}
// Groups the tasks for display only. The .slice() matters: sort() reorders in place,
// so sorting DB.sarcini directly would permanently shuffle the loaded data.
function sarciniGrouped(rows=DB.sarcini){
  const groups = TASK_STATUS_ORDER.map(status => ({
    status, slug: TASK_STATUS_SLUG[status], label: trEnum(status),
    rows: rows.filter(s => s.status===status),
  }));
  // Anything with an unexpected status still gets shown rather than silently dropped.
  const alteStatusuri = rows.filter(s => !TASK_STATUS_ORDER.includes(s.status));
  if(alteStatusuri.length) groups.push({ status:'—', slug:'other', label:'—', rows:alteStatusuri });
  return groups
    .filter(g => g.rows.length)
    .map(g => ({ ...g, rows: g.rows.slice().sort((a,b)=>b.dataInreg.localeCompare(a.dataInreg)) }));
}
function taskTableHead(){
  return `<thead><tr><th>${t('th_data')}</th><th>${t('ta_th_inregDe')}</th><th>${t('th_descriere')}</th><th>${t('ta_th_status')}</th><th>${t('ta_th_solDe')}</th><th></th></tr></thead>`;
}
function taskGroupsRows(groups){
  return groups.map(group=>`
    <tr class="task-group g-${group.slug}"><td colspan="6">${esc(group.label)} · ${group.rows.length}</td></tr>
    ${group.rows.map(task=>{
      const stale = task.status!=='soluționat' && daysDiff(task.dataInreg)<=-2;
      return `<tr class="task-row task-${group.slug}">
        <td class="td-muted">${stale?'<span class="row-flag red"></span>':''}${fmtDate(task.dataInreg)}</td>
        <td class="td-muted">${esc(task.adminInreg)}</td><td>${esc(task.descriere)}</td>
        <td>
          ${isAsistent() ? `<span class="badge ${task.status==='soluționat'?'green':task.status==='în lucru'?'yellow':'red'}">${esc(trEnum(task.status))}</span>` : `<select class="task-select s-${group.slug}" onchange="updateTaskStatus('${task.id}', this.value)">
            <option value="nesoluționat" ${task.status==='nesoluționat'?'selected':''}>${trEnum('nesoluționat')}</option>
            <option value="în lucru" ${task.status==='în lucru'?'selected':''}>${trEnum('în lucru')}</option>
            <option value="soluționat" ${task.status==='soluționat'?'selected':''}>${trEnum('soluționat')}</option>
          </select>`}
        </td>
        <td class="td-muted">${esc(task.adminSolutionare)||'—'}</td>
        <td class="row-actions">${editBtn('sarcini', task.id)}<button class="btn-danger" ${disabledAttr(true)} onclick="removeRow('sarcini','${task.id}')">${t('btn_delete')}</button></td>
      </tr>`;
    }).join('')}`).join('');
}
function taskTableSegment(groups, solvedSegment=false){
  if(!groups.length) return '';
  const rowCount=groups.reduce((sum,group)=>sum+group.rows.length,0);
  const scrollSolved=solvedSegment && rowCount>10;
  return `<div class="table-scroll task-list-scroll task-table-segment ${scrollSolved?'has-overflow':''}" ${scrollSolved?'style="--task-group-count:1;--task-visible-count:10"':''}><table>
    ${taskTableHead()}<tbody>${taskGroupsRows(groups)}</tbody>
  </table></div>`;
}
function renderSarcini(){
  const filteredTasks = sarciniFiltered();
  const groups = sarciniGrouped(filteredTasks);
  const solvedGroups = groups.filter(group=>group.status==='soluționat');
  const activeGroups = groups.filter(group=>group.status!=='soluționat');
  const openCount = DB.sarcini.filter(s=>s.status==='nesoluționat' || s.status==='în lucru').length;
  const solvedCount = DB.sarcini.filter(s=>s.status==='soluționat').length;
  return `
  <div class="view-head"><div class="view-title">${t('ta_title')}</div></div>
  <div class="view-sub">${t('ta_sub')}</div>

  <div class="stats-row">
    <div class="stat-card"><div class="stat-label">${t('ta_total')}</div><div class="stat-value">${DB.sarcini.length}</div></div>
    <div class="stat-card warn"><div class="stat-label">${t('ta_nesolutionate')}</div><div class="stat-value c-yellow">${DB.sarcini.filter(s=>s.status!=='soluționat').length}</div></div>
    <div class="stat-card crit"><div class="stat-label">${t('ta_restante')}</div><div class="stat-value c-red">${staleTasks().length}</div></div>
  </div>

  <div class="add-form">
    <div class="form-title">${t('ta_addTitle')}</div>
    <div class="form-grid" style="grid-template-columns:0.8fr 1fr 2fr auto">
      <div class="field"><label>${t('th_data')}</label><input id="taf-data" type="date" value="${todayISO()}"></div>
      <div class="field"><label>${t('th_administrator')}</label>${taskAdministratorSelect()}</div>
      <div class="field"><label>${t('ta_descriere')}</label><input id="taf-desc" placeholder="${t('ta_descrierePh')}"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" ${disabledAttr()} onclick="addSarcina()">${t('btn_add')}</button></div>
    </div>
  </div>

  <div class="table-wrap">
    <div class="table-header">
      <div class="table-title">${filteredTasks.length} ${plural(filteredTasks.length,'ta_countSuffix')}</div>
      <div class="task-filter-bar">
        <div class="toggle-group" role="group" aria-label="${esc(t('ta_countSuffix'))}">
          <button type="button" class="toggle-btn ${taskFilter==='all'?'active':''}" aria-pressed="${taskFilter==='all'}" onclick="setTaskFilter('all')">${t('ta_filterAll')} · ${DB.sarcini.length}</button>
          <button type="button" class="toggle-btn ${taskFilter==='open'?'active':''}" aria-pressed="${taskFilter==='open'}" onclick="setTaskFilter('open')">${t('ta_filterOpen')} · ${openCount}</button>
          <button type="button" class="toggle-btn ${taskFilter==='solved'?'active':''}" aria-pressed="${taskFilter==='solved'}" onclick="setTaskFilter('solved')">${t('ta_filterSolved')} · ${solvedCount}</button>
        </div>
      </div>
    </div>
    ${filteredTasks.length
      ? `${taskTableSegment(activeGroups,false)}${taskTableSegment(solvedGroups,true)}`
      : `<div class="table-scroll task-table-segment"><table>${taskTableHead()}<tbody><tr><td class="td-empty" colspan="6">${t('ta_none')}</td></tr></tbody></table></div>`}
  </div>`;
}
async function addSarcina(){
  const desc = document.getElementById('taf-desc').value.trim();
  if(!desc){ alert(t('ta_needDesc')); return; }
  const [administratorType, administratorId] = document.getElementById('taf-admin').value.split(':');
  if(!administratorId) return;
  const administratorServiciuInregId = administratorType==='service' ? administratorId : null;
  const adminInregId = administratorType==='account' ? administratorId : currentAdminId;
  const row = { data_inreg: document.getElementById('taf-data').value||todayISO(), admin_inreg_id:adminInregId, administrator_serviciu_inreg_id:administratorServiciuInregId, descriere: desc, status:'nesoluționat' };
  const { data, error } = await sb.from('sarcini').insert(row).select().single();
  if(error){ alert('Salvarea a eșuat: ' + error.message); return; }
  const administratorName = administratorServiciuInregId
    ? DB.serviciuAdministratori.find(a=>a.id===administratorServiciuInregId)?.nume
    : publicAdminName(DB.administratori.find(a=>a.id===adminInregId));
  DB.sarcini.unshift({id:data.id, dataInreg:data.data_inreg, administratorServiciuInregId:data.administrator_serviciu_inreg_id, adminInreg:administratorName||currentAdmin, descriere:data.descriere, status:data.status, actiuni:data.actiuni, dataSolutionare:data.data_solutionare, adminSolutionare:''});
  await logAction(`A înregistrat sarcina: ${desc}`);
  render();
}
async function updateTaskStatus(id, status){
  const t = DB.sarcini.find(s=>s.id===id); if(!t) return;
  const previousStatus = t.status;
  const { data, error } = await sb.rpc('schimba_status_sarcina', { p_sarcina_id:id, p_status:status });
  if(error){ alert('Actualizarea a eșuat: ' + error.message); render(); return; }
  if(!data || !data.length){ alert('Actualizarea a eșuat: nu aveți permisiunea necesară.'); render(); return; }
  const row = data[0];
  t.status = row.status;
  t.dataSolutionare = row.data_solutionare;
  t.administratorServiciuSolutionareId = row.administrator_serviciu_solutionare_id;
  t.adminSolutionare = row.status==='soluționat' ? journalActorName() : '';
  if(isFullAdmin() && previousStatus!==status){
    DB.jurnal.unshift({id:uid(), cont:journalActorName(), data:todayISO(), actiune:`${journalActorName()} a schimbat statutul sarcinii „${t.descriere}” din „${previousStatus}” în „${status}”`});
  }
  render();
}

/* ══════════════════════ OBSERVAȚII ══════════════════════ */
let observationTargetMode = 'participant';
function setObservationTargetMode(mode){
  observationTargetMode = mode==='general' ? 'general' : 'participant';
  render();
}
function observationTargetToggle(){
  return `<div class="toggle-group ob-target-toggle" role="group" aria-label="${esc(t('ob_targetType'))}">
    <button type="button" class="toggle-btn ${observationTargetMode==='participant'?'active':''}" aria-pressed="${observationTargetMode==='participant'}" onclick="setObservationTargetMode('participant')">${t('ob_targetParticipant')}</button>
    <button type="button" class="toggle-btn ${observationTargetMode==='general'?'active':''}" aria-pressed="${observationTargetMode==='general'}" onclick="setObservationTargetMode('general')">${t('ob_targetGeneral')}</button>
  </div>`;
}
function renderObservatii(){
  const counts = {};
  DB.observatii.forEach(o=>{ counts[o.categorie]=(counts[o.categorie]||0)+1; });
  return `
  <div class="view-head"><div class="view-title">${t('ob_title')}</div></div>
  <div class="view-sub">${t('ob_sub')}</div>

  <div style="margin-bottom:20px">${OBS_CATEGORIES.map(c=>`<span class="tag">${trEnum(c)} · ${counts[c]||0}</span>`).join('')}</div>

  <div class="add-form">
    <div class="form-title">${t('ob_addTitle')}</div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr 1.4fr auto">
      ${observationTargetMode==='participant'
        ? `<div class="field"><label>${t('th_participant')}</label>${autocompleteField('of-participant', participantAcOptions())}</div>`
        : `<div class="field"><label>${t('ob_subject')}</label><input id="of-subiect" maxlength="120" placeholder="${t('ob_subjectPh')}"></div>`}
      <div class="field"><label>${t('ob_categorie')}</label><select id="of-categorie">${OBS_CATEGORIES.map(c=>`<option value="${c}" ${observationTargetMode==='general'&&c==='Altă situație'?'selected':''}>${trEnum(c)}</option>`).join('')}</select></div>
      <div class="field"><label>${t('ob_descScurta')}</label><input id="of-desc" placeholder="${t('ob_descScurtaPh')}"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" ${disabledAttr()} onclick="addObservatie()">${t('btn_add')}</button></div>
      ${observationTargetToggle()}
    </div>
  </div>

  <div class="table-wrap">
    <div class="table-header"><div class="table-title">${DB.observatii.length} ${plural(DB.observatii.length,'ob_countSuffix')}</div></div>
    <div class="table-scroll observations-list-scroll ${DB.observatii.length>10?'has-overflow':''}"><table>
      <thead><tr><th>${t('th_data')}</th><th>${t('ob_target')}</th><th>${t('ob_categorie')}</th><th>${t('th_descriere')}</th><th></th></tr></thead>
      <tbody>${DB.observatii.length ? DB.observatii.slice().sort((a,b)=>b.data.localeCompare(a.data)).map(o=>`
        <tr><td class="td-muted">${fmtDate(o.data)}</td>${o.participantId
          ? `<td class="td-name" onclick="openProfile('${o.participantId}')">${esc(observationTargetName(o))}</td>`
          : `<td class="td-name">${esc(observationTargetName(o))}</td>`}
        <td><span class="badge muted">${esc(trEnum(o.categorie))}</span></td><td>${esc(o.descriere)}</td>
        <td class="row-actions">${editBtn('observatii', o.id)}<button class="btn-danger" ${disabledAttr(true)} onclick="removeRow('observatii','${o.id}')">${t('btn_delete')}</button></td></tr>`).join('') : `<tr><td class="td-empty" colspan="5">${t('ob_none')}</td></tr>`}</tbody>
    </table></div>
  </div>`;
}
async function addObservatie(){
  const isGeneral = observationTargetMode==='general';
  const participantId = isGeneral ? null : document.getElementById('of-participant')?.value;
  const subiect = isGeneral ? document.getElementById('of-subiect')?.value.trim() : null;
  if(!isGeneral && !participantId){ alert(t('ob_needParticipant')); return; }
  if(isGeneral && !subiect){ alert(t('ob_needSubject')); return; }
  const categorie = document.getElementById('of-categorie').value;
  const row = { data:todayISO(), participant_id:participantId, subiect, categorie, descriere:document.getElementById('of-desc').value.trim()||null };
  const { data, error } = await sb.from('observatii').insert(row).select().single();
  if(error){ alert('Salvarea a eșuat: ' + error.message); return; }
  const saved = {id:data.id, data:data.data, participantId:data.participant_id, subiect:data.subiect, categorie:data.categorie, descriere:data.descriere, createdAt:data.created_at};
  DB.observatii.unshift(saved);
  await logAction(`A înregistrat o observație (${categorie}) pentru ${observationTargetName(saved)}`);
  render();
}

/* ══════════════════════ PAUZĂ TEHNICĂ ══════════════════════ */
// durata în minute între două ore „HH:MM”; pauzele care trec de miezul nopții se rotesc peste 24h
function pauzaDurata(oraStart, oraStop){
  if(!oraStart || !oraStop) return null;
  const [h1,m1] = oraStart.split(':').map(Number), [h2,m2] = oraStop.split(':').map(Number);
  if([h1,m1,h2,m2].some(n=>Number.isNaN(n))) return null;
  let minute = (h2*60+m2) - (h1*60+m1);
  if(minute < 0) minute += 24*60;
  return minute;
}
// tabelul arată doar cele mai recente înregistrări, cu derulare internă (ca jurnalul din Tablou de bord)
const PAUZA_TEHNICA_LIMIT = 30;
function pauzeTehniceSortate(){
  return DB.pauzeTehnice.slice().sort((a,b)=>`${b.data}T${b.oraStart||''}`.localeCompare(`${a.data}T${a.oraStart||''}`));
}
function renderPauzaTehnica(){
  const rows = pauzeTehniceSortate();
  const vizibile = rows.slice(0, PAUZA_TEHNICA_LIMIT);
  const from = addDays(todayISO(), -30);
  const recente = rows.filter(p=>p.data >= from);
  const minuteTotal = recente.reduce((sum,p)=>sum + (pauzaDurata(p.oraStart,p.oraStop)||0), 0);
  const medie = recente.length ? Math.round(minuteTotal/recente.length) : 0;
  return `
  <div class="view-head"><div class="view-title">${t('pt_title')}</div></div>
  <div class="view-sub">${t('pt_sub')}</div>

  <div class="stats-row">
    <div class="stat-card"><div class="stat-label">${t('pt_totalPauze')}</div><div class="stat-value">${recente.length}</div></div>
    <div class="stat-card warn"><div class="stat-label">${t('pt_totalMinute')}</div><div class="stat-value">${minuteTotal}</div></div>
    <div class="stat-card"><div class="stat-label">${t('pt_medie')}</div><div class="stat-value">${medie} ${t('pt_minSuffix')}</div></div>
  </div>

  <div class="add-form">
    <div class="form-title">${t('pt_addTitle')}</div>
    <div class="form-grid" style="grid-template-columns:0.9fr 0.7fr 0.7fr 0.9fr 2fr auto">
      <div class="field"><label>${t('th_data')}</label><input id="ptf-data" type="date" value="${todayISO()}"></div>
      <div class="field"><label>${t('pt_oraStart')}</label><input id="ptf-ora-start" type="time"></div>
      <div class="field"><label>${t('pt_oraStop')}</label><input id="ptf-ora-stop" type="time"></div>
      <div class="field"><label>${t('pt_teren')}</label><select id="ptf-teren">${TERENURI.map(teren=>`<option>${esc(teren)}</option>`).join('')}</select></div>
      <div class="field"><label>${t('pt_descriere')}</label><input id="ptf-descriere" maxlength="400" placeholder="${t('pt_descrierePh')}"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" ${disabledAttr()} onclick="addPauzaTehnica()">${t('btn_add')}</button></div>
    </div>
  </div>

  <div class="table-wrap">
    <div class="table-header"><div class="table-title">${rows.length} ${plural(rows.length,'pt_countSuffix')}</div>${rows.length > vizibile.length ? `<div class="table-hint">${t('pt_showing')(vizibile.length, rows.length)}</div>` : ''}</div>
    <div class="table-scroll recent-actions-scroll"><table>
      <thead><tr><th>${t('th_data')}</th><th>${t('pt_th_interval')}</th><th>${t('pt_th_durata')}</th><th>${t('pt_th_teren')}</th><th>${t('pt_th_descriere')}</th><th></th></tr></thead>
      <tbody>${vizibile.length ? vizibile.map(p=>{
        const durata = pauzaDurata(p.oraStart, p.oraStop);
        return `<tr><td class="td-muted">${fmtDate(p.data)}</td>
        <td class="td-muted">${esc(p.oraStart)} — ${esc(p.oraStop)}</td>
        <td class="td-gold">${durata==null?'—':`${durata} ${t('pt_minSuffix')}`}</td>
        <td><span class="badge gold">${esc(p.teren)}</span></td>
        <td>${esc(p.descriere)||'—'}</td>
        <td class="row-actions">${editBtn('pauze_tehnice', p.id)}<button class="btn-danger" ${disabledAttr(true)} onclick="removeRow('pauze_tehnice','${p.id}')">${t('btn_delete')}</button></td></tr>`;
      }).join('') : `<tr><td class="td-empty" colspan="6">${t('pt_none')}</td></tr>`}</tbody>
    </table></div>
  </div>`;
}
async function addPauzaTehnica(){
  const oraStart = document.getElementById('ptf-ora-start').value;
  const oraStop = document.getElementById('ptf-ora-stop').value;
  if(!oraStart || !oraStop){ alert(t('pt_needOre')); return; }
  const descriere = document.getElementById('ptf-descriere').value.trim();
  if(!descriere){ alert(t('pt_needDescriere')); return; }
  const durataMin = pauzaDurata(oraStart, oraStop);
  if(durataMin > 180 && !confirm(t('pt_confirmLunga')(durataMin))) return;
  const row = {
    data: document.getElementById('ptf-data').value || todayISO(),
    ora_start: oraStart,
    ora_stop: oraStop,
    teren: document.getElementById('ptf-teren').value,
    descriere,
  };
  const { data, error } = await sb.from('pauze_tehnice').insert(row).select().single();
  if(error){ alert('Salvarea a eșuat: ' + error.message); return; }
  DB.pauzeTehnice.unshift({id:data.id, data:data.data, oraStart:String(data.ora_start||'').slice(0,5), oraStop:String(data.ora_stop||'').slice(0,5), teren:data.teren, descriere:data.descriere, createdAt:data.created_at});
  await logAction(`A înregistrat o pauză tehnică pe terenul ${row.teren} (${oraStart}–${oraStop})`);
  render();
}

/* ══════════════════════ RAPOARTE ══════════════════════ */
let reportState = { type:'total', from: addDays(todayISO(),-30), to: todayISO() };
const REPORT_TYPES = ['total','spalatorie','medical','daune','arbitraj','inventar'];
// the month picker shows a month only when the range is exactly that calendar month
function reportFullMonth(){
  const { from, to } = reportState;
  if(!from || from.slice(8)!=='01') return '';
  return addDays(addMonths(from,1),-1)===to ? from.slice(0,7) : '';
}
function reportMonthCounts(){
  return countsByMonth([...DB.intarzieri, ...DB.spalatorie, ...DB.daune, ...DB.arbitraj, ...DB.treninguri, ...DB.observatii, ...DB.fairPlay, ...DB.meciuri,
    ...DB.hostel.map(h=>({ data:h.dataCazare })), ...DB.lenjerie.map(l=>({ data:l.dataEliberare }))].filter(r=>r.data));
}
function reportRangeCount(){
  const { from, to } = reportState;
  return Object.entries(reportMonthCountsByDay()).filter(([d])=>d>=from && d<=to).reduce((a,[,v])=>a+v,0);
}
function reportMonthCountsByDay(){
  const c = {};
  [...DB.intarzieri, ...DB.spalatorie, ...DB.daune, ...DB.arbitraj, ...DB.treninguri, ...DB.observatii, ...DB.fairPlay, ...DB.meciuri,
   ...DB.hostel.map(h=>({ data:h.dataCazare })), ...DB.lenjerie.map(l=>({ data:l.dataEliberare }))].forEach(r=>{ if(r.data) c[r.data]=(c[r.data]||0)+1; });
  return c;
}
function setReportMonth(m){
  if(!m) return;
  reportState.from = m+'-01';
  reportState.to = addDays(addMonths(m+'-01',1),-1);
  render();
}
function updateReportDate(key, value){
  if(!isCompleteDate(value)) return;
  reportState[key] = value;
  if(reportState.from > reportState.to){
    if(key==='from') reportState.to = value;
    else reportState.from = value;
  }
  // redraw only below the date fields so a date being typed is never replaced mid-edit
  const body = document.getElementById('report-body');
  if(!body){ render(); return; }
  const other = document.getElementById(key==='from' ? 'report-to' : 'report-from');
  if(other) other.value = key==='from' ? reportState.to : reportState.from;
  body.innerHTML = renderRapoarteBody();
  enhanceIcons(body);
  const mp = document.getElementById('mp-rapoarte');
  if(mp){ mp.outerHTML = monthPicker('rapoarte', reportFullMonth(), reportMonthCounts(), 'setReportMonth', { allowAll:false, emptyLabel:t('re_intervalPersonalizat'), emptyCount:reportRangeCount() }); }
}
function renderRapoarte(){
  if(!isFullAdmin()) return `
    <div class="view-head"><div class="view-title">${t('act_sectionTitle')}</div></div>
    <div class="view-sub">${t('act_sectionSub')}</div>
    ${renderActeSchimbList()}`;
  const report = reportSections();
  return `
  <div class="view-head"><div class="view-title">${t('re_title')}</div></div>
  <div class="view-sub">${t('re_sub')}</div>

  <div class="add-form">
    <div class="form-title">${t('re_perioada')}</div>
    <div class="form-grid" style="grid-template-columns:minmax(0,1fr) minmax(0,520px);margin-bottom:12px">
      <div class="field"><label>${t('re_tipRaport')}</label><select id="report-type" onchange="reportState.type=this.value; render();">${REPORT_TYPES.map(rt=>`<option value="${rt}" ${rt===reportState.type?'selected':''}>${t('re_type_'+rt)}</option>`).join('')}</select></div>
      <div class="field"><label>${t('re_luna')}</label>${monthPicker('rapoarte', reportFullMonth(), reportMonthCounts(), 'setReportMonth', { allowAll:false, emptyLabel:t('re_intervalPersonalizat'), emptyCount:reportRangeCount() })}</div>
    </div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr auto auto auto">
      <div class="field"><label>${t('re_de_la')}</label><input id="report-from" type="date" value="${reportState.from}" onchange="updateReportDate('from', this.value)"></div>
      <div class="field"><label>${t('re_pana_la')}</label><input id="report-to" type="date" value="${reportState.to}" onchange="updateReportDate('to', this.value)"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-ghost" onclick="exportExcelReport()"><svg class="btn-icon" viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/></svg>${t('re_excel')}</button></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-ghost" onclick="exportPdfReport()"><svg class="btn-icon" viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/></svg>${t('re_pdf')}</button></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" onclick="printReport()"><svg class="btn-icon" viewBox="0 0 24 24"><path d="M7 9V3h10v6"/><path d="M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/></svg>${t('re_print')}</button></div>
    </div>
  </div>
  <div id="report-body">${renderRapoarteBody(report)}</div>`;
}
function renderRapoarteBody(report = reportSections()){
  return `
  <div class="view-sub" style="margin:-6px 0 18px">${fmtDate(report.from)} — ${fmtDate(report.to)}</div>

  ${report.sections.map(section=>`
  <div class="report-card">
    <div class="form-title" style="margin-bottom:10px">${esc(section.title)}</div>
    ${section.rows.map(row=>`<div class="report-row"><span>${esc(row[0])}</span><span class="td-gold">${esc(row[1])}</span></div>`).join('')}
  </div>`).join('')}

  ${renderActeSchimbList()}`;
}

function reportRange(){
  const from = reportState.from <= reportState.to ? reportState.from : reportState.to;
  const to = reportState.from <= reportState.to ? reportState.to : reportState.from;
  return { from, to, includes: iso => !!iso && iso >= from && iso <= to };
}
function summaryIntarzieri(range){
  const filtered = DB.intarzieri.filter(r=>range.includes(r.data));
  const counts = {};
  filtered.forEach(r=>{ counts[r.participantId]=(counts[r.participantId]||0)+1; });
  return [
    [t('re_m_totalIntarzieri'), filtered.length],
    [t('re_m_totalMinute'), filtered.reduce((s,r)=>s+(r.minuteIntarziere||0),0)],
    [t('re_m_frecventi'), Object.values(counts).filter(count=>count>=3).length],
  ];
}
function summarySpalatorie(range){
  const filtered = DB.spalatorie.filter(r=>range.includes(r.data) || range.includes(r.dataReturnare));
  return [
    [t('re_m_operatiuniSpal'), filtered.length],
    [t('re_m_cantitateArt'), filtered.reduce((s,r)=>s+(r.cantitate||1),0)],
    [t('re_m_cheltuieliTotale'), filtered.reduce((s,r)=>s+Number(r.suma||0),0)+' MDL'],
    [t('re_m_spalReturnate'), filtered.filter(r=>r.dataReturnare).length],
    [t('re_m_spalNereturnate'), filtered.filter(r=>!r.dataReturnare).length],
  ];
}
function summaryMedical(range){
  const rows = medicalRows().filter(r=>range.includes(r.dataAviz) || range.includes(r.dataExpirare));
  return [
    [t('re_m_aviziPerioada'), rows.length],
    [t('re_m_valabile'), rows.filter(r=>r.status==='valabil').length],
    [t('re_m_expiraCurand'), rows.filter(r=>r.status==='expiră curând').length],
    [t('re_m_expirate'), rows.filter(r=>r.status==='expirat').length],
  ];
}
function summaryDaune(range){
  return [[t('re_m_totalDaune'), DB.daune.filter(r=>range.includes(r.data)).length]];
}
function summaryArbitraj(range){
  const filtered = DB.arbitraj.filter(r=>range.includes(r.data));
  return [
    [t('re_m_eliberariArb'), filtered.length],
    [t('re_m_mingi'), filtered.reduce((s,r)=>s+(r.cantitateMingi||0),0)],
  ];
}
function summaryAntrenamente(range){
  const filtered = DB.treninguri.filter(r=>range.includes(r.data));
  const rows = [
    [t('re_m_totalSesiuniAntrenament'), filtered.length],
    [t('re_m_incasatAntrenament'), filtered.reduce((s,r)=>s+Number(r.sumaJucator||0),0)+' MDL'],
  ];
  TRAINERS.forEach(tr=>{
    const forTrainer = filtered.filter(r=>r.antrenor===tr);
    rows.push([tr, forTrainer.reduce((s,r)=>s+Number(r.sumaAntrenor||0),0)+' MDL (' + forTrainer.length + ' ' + plural(forTrainer.length,'an_countSuffix') + ')']);
  });
  return rows;
}
function summaryInventar(){
  return inventarSorted().map(i=>[`${esc(trEnum(i.denumire))}${i.marime!=='—'?' — '+i.marime:''}${i.conditie==='uzat'?` (${t('le_stockUsed').toLowerCase()})`:''}`, `${inventoryCurrent(i)} ${i.um}`]);
}
function reportSections(){
  const range = reportRange();
  const type = reportState.type;
  let sections;
  if(type==='total'){
    sections = [
      { title:t('re_sect_participanti'), rows:[
        [t('re_r_obsAbs'), DB.observatii.filter(r=>range.includes(r.data)).length],
        [t('re_r_cazariHostel'), DB.hostel.filter(r=>range.includes(r.dataCazare)).length],
        [t('re_r_avizeExp'), medicalRows().filter(r=>r.status==='expirat' && range.includes(r.dataExpirare)).length],
        [t('re_r_dauneProv'), DB.daune.filter(r=>range.includes(r.data)).length],
      ]},
      { title:t('re_sect_meciuri'), rows:(()=>{
        const ms = DB.meciuri.filter(m=>range.includes(m.data));
        const days = new Set(ms.map(m=>m.data));
        const teams = new Set(ms.flatMap(m=>[m.echipaAId, m.echipaBId]));
        return [
          [t('re_r_meciuri'), ms.length], [t('re_r_meciuriFaraScor'), ms.filter(m=>m.scorA==null||m.scorB==null).length],
          [t('re_r_zileJoc'), days.size], [t('re_r_echipe'), teams.size],
        ];
      })() },
      { title:t('re_sect_admin'), rows:[
        [t('re_r_schimburi'), DB.serviciu.filter(r=>range.includes(r.data)).length],
        [t('re_r_sarciniInreg'), DB.sarcini.filter(r=>range.includes(r.dataInreg)).length],
        [t('re_r_sarciniSol'), DB.sarcini.filter(r=>r.status==='soluționat' && range.includes(r.dataSolutionare)).length],
      ]},
      { title:t('re_sect_fin'), rows:[
        [t('re_r_cheltSpal'), DB.spalatorie.filter(r=>range.includes(r.data)).reduce((s,r)=>s+Number(r.suma||0),0)+' MDL'],
      ]},
      { title:t('re_sect_inv'), rows:summaryInventar() },
    ];
  } else {
    const builders = {
      intarzieri: { title:t('re_sect_intarzieri'), rows:summaryIntarzieri(range) },
      spalatorie: { title:t('re_sect_spalatorie'), rows:summarySpalatorie(range) },
      medical: { title:t('re_sect_medical'), rows:summaryMedical(range) },
      daune: { title:t('re_sect_daune'), rows:summaryDaune(range) },
      arbitraj: { title:t('re_sect_arbitraj'), rows:summaryArbitraj(range) },
      antrenamente: { title:t('re_sect_antrenamente'), rows:summaryAntrenamente(range) },
      inventar: { title:t('re_sect_inv'), rows:summaryInventar() },
    };
    sections = [builders[type]];
  }
  return { ...range, type, sections };
}
function reportFileBase(report){ return `raport_${report.type}_${report.from}_${report.to}`; }
function excelReportRows(report){
  const rows = [];
  const type = report.type;
  const wants = domain => !['intarzieri','antrenamente'].includes(domain) && (type==='total' || type===domain);
  const add = (data, sectiune, tip, persoana='', detalii='', valoare='', unitate='', statut='', dataFinala='') => {
    rows.push({ data:data||'', sectiune, tip, persoana, detalii, valoare, unitate, statut, dataFinala:dataFinala||'' });
  };

  if(wants('total')){
    DB.participanti.filter(p=>report.includes(p.dataInregistrarii)).forEach(p=>add(
      p.dataInregistrarii, 'Participanți', 'Participant înregistrat', `${p.nume} ${p.prenume}`,
      [
        p.nrDulap ? `dulap ${p.nrDulap}` : '',
        p.dataNasterii ? `născut(ă) ${fmtDate(p.dataNasterii)}` : '',
        p.telefon || '', p.email || '', p.adresa || '',
        p.marime ? `mărime ${p.marime}` : '',
      ].filter(Boolean).join(' · '), '', '', p.statut
    ));
  }
  if(wants('medical')){
    DB.participanti.forEach(p=>{
      const expirare = p.dataAvizMedical ? addMonths(p.dataAvizMedical, 6) : '';
      if(!p.dataAvizMedical || report.includes(p.dataAvizMedical) || report.includes(expirare) || expirare < report.to){
        add(p.dataAvizMedical || report.to, 'Medical', 'Aviz medical', `${p.nume} ${p.prenume}`,
          p.dataAvizMedical ? `Expiră la ${fmtDate(expirare)}` : 'Fără aviz medical înregistrat',
          '', '', !p.dataAvizMedical ? 'lipsă' : expirare < report.to ? 'expirat' : 'valabil', expirare);
      }
    });
  }
  if(wants('intarzieri')){
    DB.intarzieri.filter(r=>report.includes(r.data)).forEach(r=>add(
      r.data, 'Întârzieri', 'Întârziere', entryPersonName(r),
      [r.minuteIntarziere!=null ? `${r.minuteIntarziere} min` : '', r.motiv || ''].filter(Boolean).join(' · ')
    ));
  }
  if(wants('total')){
    DB.serviciu.filter(r=>report.includes(r.data)).forEach(r=>add(
      r.data, 'Serviciu administratori', 'Schimb programat', r.administrator
    ));
  }
  if(wants('spalatorie')){
    DB.spalatorie.filter(r=>report.includes(r.data) || report.includes(r.dataReturnare)).forEach(r=>add(
      r.data, 'Spălătorie', 'Operațiune spălătorie', r.participantId ? participantName(r.participantId) : t('sp_locatia'),
      [r.tipArticole || '', `${r.cantitate||1} buc`].filter(Boolean).join(' · '), Number(r.suma||0), 'MDL', r.dataReturnare ? 'returnat' : 'nereturnat', r.dataReturnare
    ));
  }
  if(wants('total')){
    DB.hostel.filter(r=>report.includes(r.dataCazare)).forEach(r=>add(
      r.dataCazare, 'Hostel', 'Cazare', participantName(r.participantId), r.observatii || ''
    ));
    DB.lenjerie.filter(r=>report.includes(r.dataEliberare) || report.includes(r.dataReturnare)).forEach(r=>add(
      r.dataEliberare, 'Lenjerie', 'Eliberare lenjerie', participantName(r.participantId),
      '', 1, 'set', r.dataReturnare ? 'returnat' : 'nereturnat', r.dataReturnare
    ));
  }
  if(wants('daune')){
    DB.daune.filter(r=>report.includes(r.data)).forEach(r=>add(
      r.data, 'Daune și recuperări', 'Daună', participantName(r.participantId),
      [r.inventarAfectat, r.natura, r.avertizor ? `${t('da2_avertizor')}: ${r.avertizor}` : '', r.observatii].filter(Boolean).join(' · '),
      Number(r.valoareEstimata||0), 'MDL', r.bunDeterioratDistrus || ''
    ));
  }
  if(wants('arbitraj')){
    DB.arbitraj.filter(r=>report.includes(r.data)).forEach(r=>add(
      r.data, 'Arbitraj', 'Eliberare mingi', r.arbitru,
      [r.turneu, r.observatii].filter(Boolean).join(' · '), Number(r.cantitateMingi||0), 'buc'
    ));
  }
  if(wants('antrenamente')){
    DB.treninguri.filter(r=>report.includes(r.data)).forEach(r=>add(
      r.data, 'Antrenamente', 'Sesiune antrenament', participantName(r.participantId),
      [r.antrenor, r.ora?`ora ${String(r.ora).slice(0,5)}`:'', `jucător ${r.sumaJucator} MDL`, `antrenor ${r.sumaAntrenor} MDL`, r.observatii].filter(Boolean).join(' · ')
    ));
  }
  if(wants('total')){
    DB.sarcini.filter(r=>report.includes(r.dataInreg) || report.includes(r.dataSolutionare)).forEach(r=>add(
      r.dataInreg, 'Sarcini', 'Sarcină', r.adminInreg,
      [r.descriere, r.actiuni].filter(Boolean).join(' · '), '', '', r.status,
      r.dataSolutionare
    ));
    DB.observatii.filter(r=>report.includes(r.data)).forEach(r=>add(
      r.data, 'Observații', r.categorie || 'Observație', observationTargetName(r), r.descriere || ''
    ));
    DB.jurnal.filter(r=>report.includes(r.data)).forEach(r=>add(
      r.data, 'Jurnal activitate', 'Acțiune administrator', r.cont, r.actiune || ''
    ));
  }
  if(wants('inventar')){
    inventarSorted().forEach(i=>add(
      report.to, 'Inventar', 'Situație la finalul perioadei', i.denumire,
      [
        i.culoare && i.culoare!=='—' ? `culoare ${i.culoare}` : '',
        i.marime && i.marime!=='—' ? `mărime ${i.marime}` : '',
        `inițial ${i.cantitateInitiala}`,
        `intrări ${i.intrari}`,
        `ieșiri ${i.iesiri}`,
        `minim ${i.cantitateMinima}`,
        i.observatii || '',
      ].filter(Boolean).join(' · '),
      inventoryCurrent(i), i.um, inventoryStare(inventoryCurrent(i), i.cantitateMinima)
    ));
  }

  return rows.sort((a,b)=>String(b.data).localeCompare(String(a.data)) || a.sectiune.localeCompare(b.sectiune));
}
function exportExcelReport(){
  if(!window.XLSX){ alert(t('re_noExcel')); return; }
  const report = reportSections();
  const detailRows = excelReportRows(report);
  const workbook = XLSX.utils.book_new();
  const titleRo = report.type==='total' ? 'RAPORT COMPLET — REGISTRU ELECTRONIC BSKT CUP' : `RAPORT — ${t('re_type_'+report.type).toUpperCase()} — REGISTRU ELECTRONIC BSKT CUP`;
  const summaryRow = report.type==='total'
    ? ['Înregistrări incluse', detailRows.length, 'Participanți noi', DB.participanti.filter(p=>report.includes(p.dataInregistrarii)).length, 'Articole inventar', DB.inventar.length]
    : ['Înregistrări incluse', detailRows.length];
  const preHeaderRows = [
    [titleRo],
    [`Perioada: ${fmtDate(report.from)} — ${fmtDate(report.to)}`],
    [],
    summaryRow,
    [],
  ];
  const headerRow = ['Data','Secțiune','Tip înregistrare','Participant / responsabil','Detalii complete','Valoare','UM','Statut / rezultat','Finalizare / returnare'];
  const headerIdx = preHeaderRows.length; // 0-based row index of headerRow
  const headerRowNum = headerIdx + 1; // 1-based sheet row number
  const rows = [
    ...preHeaderRows,
    headerRow,
    ...detailRows.map(r=>[
      r.data ? new Date(`${r.data}T12:00:00`) : '',
      r.sectiune, r.tip, r.persoana, r.detalii, r.valoare, r.unitate, r.statut,
      r.dataFinala ? new Date(`${r.dataFinala}T12:00:00`) : '',
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows, { cellDates:true });
  sheet['!merges'] = [
    XLSX.utils.decode_range('A1:I1'),
    XLSX.utils.decode_range('A2:I2'),
  ];
  sheet['!cols'] = [
    {wch:13}, {wch:24}, {wch:27}, {wch:28}, {wch:64},
    {wch:13}, {wch:10}, {wch:20}, {wch:18},
  ];
  sheet['!rows'] = [{hpt:28},{hpt:21},{hpt:8},{hpt:22},{hpt:8},{hpt:26}];
  sheet['!autofilter'] = { ref:`A${headerRowNum}:I${Math.max(headerRowNum, rows.length)}` };
  sheet['!freeze'] = { xSplit:0, ySplit:headerRowNum, topLeftCell:`A${headerRowNum+1}`, activePane:'bottomLeft', state:'frozen' };
  sheet['!margins'] = { left:.25, right:.25, top:.5, bottom:.5, header:.2, footer:.2 };
  sheet['!pageSetup'] = { orientation:'landscape', fitToWidth:1, fitToHeight:0, paperSize:9 };
  for(let row=headerRowNum+1; row<=rows.length; row++){
    const dateCell = sheet[`A${row}`];
    const finalCell = sheet[`I${row}`];
    if(dateCell) dateCell.z = 'dd.mm.yyyy';
    if(finalCell) finalCell.z = 'dd.mm.yyyy';
  }
  const titleStyle = { font:{bold:true,sz:18,color:{rgb:'C8A96E'}}, fill:{fgColor:{rgb:'111820'}}, alignment:{horizontal:'left',vertical:'center'} };
  const subtitleStyle = { font:{bold:true,sz:11,color:{rgb:'5B6573'}}, fill:{fgColor:{rgb:'E9EDF2'}}, alignment:{horizontal:'left',vertical:'center'} };
  const headerStyle = { font:{bold:true,color:{rgb:'FFFFFF'}}, fill:{fgColor:{rgb:'343D49'}}, alignment:{horizontal:'center',vertical:'center',wrapText:true} };
  if(sheet.A1) sheet.A1.s = titleStyle;
  if(sheet.A2) sheet.A2.s = subtitleStyle;
  for(let col=0; col<9; col++){
    const cell = sheet[XLSX.utils.encode_cell({r:headerIdx,c:col})];
    if(cell) cell.s = headerStyle;
  }
  XLSX.utils.book_append_sheet(workbook, sheet, 'Raport');
  XLSX.writeFile(workbook, reportFileBase(report)+'.xlsx');
}
async function exportPdfReport(){
  if(!window.jspdf?.jsPDF){ alert(t('re_noPdf')); return; }
  const report = reportSections();
  const doc = new window.jspdf.jsPDF();
  try { await ensurePdfFont(doc); } catch(e){ alert('Fontul PDF nu s-a putut incarca: ' + e.message); return; }
  const body = [];
  report.sections.forEach(section=>{
    body.push([{content:section.title, colSpan:2, styles:{fillColor:[232,235,240], textColor:[35,42,52], font:'NotoSans', cellPadding:2.3}}]);
    section.rows.forEach(row=>body.push([pdfCell(row[0]), pdfCell(row[1])]));
  });
  const pdfTitle = report.type==='total' ? 'Raport si statistici' : `Raport - ${t('re_type_'+report.type)}`;
  doc.setFontSize(16); doc.text(pdfTitle, 12, 14);
  doc.setFontSize(9); doc.setTextColor(85); doc.text(`Perioada: ${fmtDate(report.from)} - ${fmtDate(report.to)}`, 12, 20);
  doc.autoTable({
    startY:25,
    head:[['Indicator','Valoare']],
    body,
    theme:'grid',
    margin:{left:12,right:12,top:12,bottom:12},
    styles:{font:'NotoSans', fontSize:8.2, cellPadding:2.1, lineColor:[205,210,218], lineWidth:.15, overflow:'linebreak'},
    headStyles:{font:'NotoSans', fillColor:[55,65,81], textColor:255, cellPadding:2.4},
    columnStyles:{0:{cellWidth:145},1:{cellWidth:41, halign:'right'}},
    rowPageBreak:'avoid',
  });
  doc.save(reportFileBase(report)+'.pdf');
}
function printReport(){
  const report = reportSections();
  const popup = window.open('', '_blank', 'width=900,height=700');
  if(!popup){ alert(t('re_popupBlocked')); return; }
  const printTitle = report.type==='total' ? t('re_title') : `${t('re_title')} — ${t('re_type_'+report.type)}`;
  const sectionsHtml = report.sections.map(section=>`
    <section><h2>${esc(section.title)}</h2><table><thead><tr><th>Indicator</th><th>Valoare</th></tr></thead>
    <tbody>${section.rows.map(r=>`<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('')}</tbody></table></section>`).join('');
  popup.document.write(`<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>Raport</title>
    <style>body{font-family:Arial,sans-serif;color:#111;margin:32px}h1{margin:0 0 6px}p{color:#555;margin:0 0 24px}
    h2{font-size:16px;margin:24px 0 8px}table{width:100%;border-collapse:collapse}th,td{padding:8px 10px;border:1px solid #ccc;text-align:left}
    th:last-child,td:last-child{text-align:right}@media print{body{margin:12mm}section{break-inside:avoid}}</style></head>
    <body><h1>${esc(printTitle)}</h1><p>Perioada: ${fmtDate(report.from)} — ${fmtDate(report.to)}</p>${sectionsHtml}</body></html>`);
  popup.document.close();
  popup.focus();
  setTimeout(()=>popup.print(), 300);
}

/* ══════════════════════ SETĂRI ══════════════════════ */
/* ══════════════════════ TABEL GOOGLE: sincronizare + săptămâni blocate ══════════════════════ */
// Sheet sync rules live in supabase/functions/sheet-sync; here: locked weeks, "changed by hand" badges and Setări → Tabel Google.
let LOCKED_WEEKS = new Set();
let tabelPending = 0;
let tabelActiv = false;      // sheet connected → header sync buttons are shown (admins)
let lastSheetReport = null;  // last quick-sync report, opened from the toast
async function loadSyncMeta(){
  if(ICON_PREVIEW_MODE) return;
  const [locks, pend, cfg, last] = await Promise.all([
    sb.from('saptamani_blocate').select('luni'),
    isFullAdmin() ? sb.from('tabel_jucatori').select('cheie', { count:'exact', head:true }).eq('status','in_asteptare') : Promise.resolve({ count:0 }),
    isFullAdmin() ? sb.from('tabel_config').select('activ').maybeSingle() : Promise.resolve({ data:null }),
    isFullAdmin() ? sb.from('sync_rezultate').select('rulat_la,ok').eq('sursa','tabel').order('id', { ascending:false }).limit(1) : Promise.resolve({ data:[] }),
  ]);
  LOCKED_WEEKS = new Set((locks.data||[]).map(r=>r.luni));
  tabelPending = pend.count || 0;
  tabelActiv = !!cfg.data?.activ;
  lastSheetSync = (last.data||[])[0] || null;
}
let lastSheetSync = null;
// the big centred strip in the middle of each relevant tab (the header has the small button too)
function syncStrip(){
  if(!isFullAdmin() || !tabelActiv) return '';
  const busy = tabelState.busy, ls = lastSheetSync;
  const when = ls ? (new Date(ls.rulat_la).toLocaleDateString('sv-SE', { timeZone:'Europe/Chisinau' })===new Date().toLocaleDateString('sv-SE', { timeZone:'Europe/Chisinau' }) ? `${t('tb_azi')} ${fmtTime(ls.rulat_la)}` : fmtDateTime(ls.rulat_la)) : t('mt_syncNiciodata');
  return `<div class="sync-strip ${ls && !ls.ok ? 'err' : ''}">
    <span class="sync-strip-text"><span class="sync-dot ${ls ? (ls.ok ? 'ok' : 'err') : ''}"></span>${t('tb_ultimaTabel')} <b>${esc(when)}</b></span>
    <button class="btn-primary sync-strip-btn ${busy?'busy':''}" ${busy?'disabled':''} onclick="quickSheetSync()">${icon('refresh')}<span>${t(busy?'mt_syncRuleaza':'tb_syncCuTabelul')}</span></button>
  </div>`;
}
// compact sync button for the header of every tab that shows sheet data
function syncHeaderBtn(){
  if(!isFullAdmin() || !tabelActiv) return '';
  const busy = tabelState.busy;
  return `<button class="btn-primary btn-sm head-sync ${busy?'busy':''}" ${busy?'disabled':''} onclick="quickSheetSync()" title="${esc(t('tb_syncTitlu'))}">${icon('refresh')}<span>${t(busy?'mt_syncRuleaza':'tb_syncScurt')}</span></button>`;
}
async function quickSheetSync(){
  const d = await runSheetSync(false, true);
  if(!d) return;
  lastSheetReport = d;
  const loturi = (d.schimbari||[]).filter(x=>x.lot).length;
  const meciuri = (d.inserate||0) + (d.actualizate||0);
  const parts = [];
  if(loturi) parts.push(t('tb_tLoturi')(loturi));
  if(meciuri) parts.push(t('tb_tMeciuri')(meciuri));
  const warn = [];
  if(tabelPending) warn.push(t('tb_tNume')(tabelPending));
  if((d.conflicte||[]).length) warn.push(t('tb_tConflicte')((d.conflicte||[]).length));
  showToast(`<b>${parts.length ? t('tb_tSincronizat') + ' ' + parts.join(', ') : t('tb_tLaZi')}</b>${warn.length ? `<span class="c-yellow"> · ${warn.join(' · ')}</span>` : ''}`,
    { action: t('tb_tRaport'), onAction: ()=>showSyncReport(lastSheetReport, false) });
}
let toastTimer = null;
function showToast(html, opts={}){
  let el = document.getElementById('app-toast');
  if(!el){ el = document.createElement('div'); el.id = 'app-toast'; el.className = 'app-toast'; document.body.appendChild(el); }
  el.innerHTML = `<span class="app-toast-text">${html}</span>${opts.action ? `<button class="btn-ghost btn-sm" id="app-toast-act">${esc(opts.action)}</button>` : ''}<button class="app-toast-x" aria-label="✕" onclick="hideToast()">✕</button>`;
  if(opts.action) document.getElementById('app-toast-act').onclick = ()=>{ hideToast(); opts.onAction?.(); };
  el.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, 8000);
}
function hideToast(){ document.getElementById('app-toast')?.classList.remove('visible'); }
function isWeekLocked(day){ return !!day && LOCKED_WEEKS.has(weekStart(day)); }
function weekLabel(luni){ return `${ddmm(luni)}–${ddmm(addDays(luni,6))}`; }
function renderWeekLocks(from, to){
  const weeks = [];
  for(let w = weekStart(from); w <= to && weeks.length < 8; w = addDays(w,7)) weeks.push(w);
  return `<div class="week-locks">${weeks.map(w=>{ const locked = LOCKED_WEEKS.has(w);
    return `<div class="week-lock ${locked?'locked':''}">
      <span class="week-lock-label">${t('pl_saptamana')} ${weekLabel(w)}</span>
      <span class="badge ${locked?'gold':'muted'}">${t(locked?'pl_blocata':'pl_deschisa')}</span>
      ${isFullAdmin() ? `<button class="btn-ghost btn-sm" onclick="toggleWeekLock('${w}', ${!locked})">${t(locked?'pl_deblocheaza':'pl_blocheaza')}</button>` : ''}
    </div>`; }).join('')}</div>`;
}
async function toggleWeekLock(luni, lock){
  if(!confirm(t(lock ? 'pl_confirmBlocare' : 'pl_confirmDeblocare')(weekLabel(luni)))) return;
  const { error } = await sb.rpc('blocheaza_saptamana', { p_luni:luni, p_blocat:lock });
  if(error){ alert(t('err_update')+' '+error.message); return; }
  await loadSyncMeta();
  render();
}
// a match whose values no longer equal what the last sync wrote was changed by hand — syncs leave it alone
function matchManualOverride(m){
  const b = m.syncBaza;
  if(!b) return false;
  if(b.data && (b.data!==m.data || (b.ora||'')!==(m.ora||'') || b.a!==m.echipaAId || b.b!==m.echipaBId
     || (b.sa??null)!==(m.scorA??null) || (b.sb??null)!==(m.scorB??null) || !!b.ot!==!!m.prelungiri)) return true;
  const lot = b.lot || {};
  return Object.entries(lot).some(([eid, keys])=>{
    const cur = rosterOf(m.id, eid).map(r=>`${r.participantId}:${r.rol}`).sort();
    return rosterLoadedDays.has(m.data) && JSON.stringify(cur) !== JSON.stringify([...keys].sort());
  });
}
async function acceptSheetForMatch(id){
  const m = DB.meciuri.find(x=>x.id===id); if(!m) return;
  if(!confirm(t('tb_confirmPreia'))) return;
  const { error } = await sb.rpc('accepta_tabel_pentru_meci', { p_meci:id });
  if(error){ alert(t('err_update')+' '+error.message); return; }
  await runSheetSync(false, true);
  await reloadMatchesForDay(m.data);
  render();
}

/* ── Setări → Tabel Google (doar administrator) ── */
let tabelState = { loaded:false, loading:false, cfg:null, last:null, names:[], showKey:false, showLinked:false, busy:false };
async function loadTabelState(){
  if(tabelState.loading || ICON_PREVIEW_MODE) return;
  tabelState.loading = true;
  const [cfg, last, names] = await Promise.all([
    sb.from('tabel_config').select('url,cheie,activ,actualizat_la').maybeSingle(),
    sb.from('sync_rezultate').select('rulat_la,ok,gasite,inserate,actualizate,eroare,detalii').eq('sursa','tabel').order('id', { ascending:false }).limit(1),
    sb.from('tabel_jucatori').select('cheie,nume,participant_id,status,propunere_id,scor,echipa,rating,aparitii,ultima_data').order('nume'),
  ]);
  tabelState = { ...tabelState, loading:false, loaded:true, cfg:cfg.data||null, last:(last.data||[])[0]||null, names:names.data||[] };
  tabelPending = tabelState.names.filter(n=>n.status==='in_asteptare').length;
  if(currentView==='setari') render();
}
function splitSheetName(nume){   // sheet writes "Firstname Lastname"; the registry keeps nume = surname
  const w = String(nume||'').trim().split(/\s+/);
  return w.length < 2 ? { nume:w[0]||'', prenume:'' } : { nume:w.slice(1).join(' '), prenume:w[0] };
}
function renderTabelGoogle(){
  if(!tabelState.loaded) loadTabelState();
  const s = tabelState, cfg = s.cfg || {};
  const pending = s.names.filter(n=>n.status==='in_asteptare');
  const linked = s.names.filter(n=>n.status!=='in_asteptare');
  const det = s.last?.detalii || {};
  const count = k => (det[k]||[]).length;
  const playerOpts = DB.participanti.slice().sort((a,b)=>a.nume.localeCompare(b.nume,'ro')).map(p=>({ value:p.id, label:`${p.nume} ${p.prenume}${p.echipaId?' · '+echipaName(p.echipaId):''}` }));
  return `<div class="add-form" id="tabel-google">
    <div class="form-title">${t('tb_title')}</div>
    <div class="view-sub" style="margin:-4px 0 14px">${t('tb_sub')}</div>

    <div class="tb-hero ${cfg.activ ? (s.last ? (s.last.ok ? 'ok' : 'err') : '') : 'off'}">
      <div class="tb-hero-info">
        <div class="tb-hero-line"><span class="sync-dot ${cfg.activ ? (s.last ? (s.last.ok ? 'ok' : 'err') : '') : ''}"></span>
          <b>${!cfg.activ ? t('tb_neconfigurat') : s.last ? `${t('tb_ultima')} ${fmtDateTime(s.last.rulat_la)}` : t('tb_niciodata')}</b></div>
        ${cfg.activ && s.last ? `<div class="tb-hero-sub">${s.last.gasite} ${t('tb_meciuriTabel')}${count('conflicte') ? ` · <span class="c-yellow">${count('conflicte')} ${t('tb_conflicte')}</span>` : ''}${count('loturi_in_asteptare') ? ` · <span class="c-yellow">${count('loturi_in_asteptare')} ${t('tb_loturiAsteapta')}</span>` : ''}${pending.length ? ` · <span class="c-yellow">${pending.length} ${t('tb_numeDeConfirmat')}</span>` : ''}${s.last.eroare ? ` · <span style="color:var(--red)">${esc(s.last.eroare)}</span>` : ''}</div>` : ''}
      </div>
      <div class="tb-hero-actions">
        <button class="btn-ghost" ${!cfg.activ||s.busy?'disabled':''} onclick="runSheetSync(true)">${t('tb_simuleaza')}</button>
        <button class="btn-primary tb-sync-btn ${s.busy?'busy':''}" ${!cfg.activ||s.busy?'disabled':''} onclick="runSheetSync(false)">${icon('refresh')}<span>${t(s.busy?'mt_syncRuleaza':'mt_syncAcum')}</span></button>
      </div>
    </div>

    <details class="tb-setup" ${cfg.activ ? '' : 'open'}>
      <summary>${t('tb_conectare')}</summary>
      <ol class="tb-steps">
        <li>${t('tb_pas1')}</li>
        <li>${t('tb_pas2')}
          <div class="invite-link-row" style="margin-top:8px">
            <input readonly value="${esc(cfg.cheie ? (s.showKey ? cfg.cheie : '•'.repeat(24)) : '')}" placeholder="${esc(t('tb_faraCheie'))}" onclick="this.select()">
            ${cfg.cheie ? `<button class="btn-ghost btn-sm" onclick="tabelState.showKey=!tabelState.showKey; render();">${t(s.showKey?'tb_ascunde':'tb_arata')}</button>
              <button class="btn-ghost btn-sm" onclick="copyText('${esc(cfg.cheie)}')">${t('st_inv_copy')}</button>` : ''}
            <button class="btn-primary btn-sm" onclick="newTabelKey(${!!cfg.cheie})">${t(cfg.cheie?'tb_cheieNoua':'tb_genereazaCheie')}</button>
          </div></li>
        <li>${t('tb_pas3')}</li>
        <li>${t('tb_pas4')}
          <div class="invite-link-row" style="margin-top:8px">
            <input id="tb-url" value="${esc(cfg.url||'')}" placeholder="https://script.google.com/macros/s/…/exec">
            <button class="btn-primary btn-sm" onclick="saveTabelUrl()">${t('btn_save')}</button>
          </div></li>
      </ol>
    </details>

    <div class="tb-names">
      <div class="tb-names-title">${t('tb_numeTitlu')} ${pending.length ? `<span class="badge gold">${pending.length}</span>` : ''}</div>
      <div class="view-sub" style="margin:2px 0 10px">${t('tb_numeSub')}</div>
      ${pending.length ? pending.map(n=>{ const sp = splitSheetName(n.nume); const id = 'tbn-'+n.cheie.replace(/[^a-z0-9]/g,'_');
        return `<div class="tb-name-row">
          <div class="tb-name-src"><b>${esc(n.nume)}</b><span class="td-muted">${esc(n.echipa||'—')}${n.rating!=null?' · ★'+n.rating:''} · ${n.aparitii} ${plural(n.aparitii,'mt_meciuriSuffix')}</span></div>
          <div class="tb-name-link">${autocompleteField(id, playerOpts, { selectedValue: n.propunere_id || '', placeholder: t('tb_alegeJucator') })}
            <button class="btn-primary btn-sm" onclick="linkSheetName('${esc(n.cheie)}','${id}')">${t('tb_leaga')}</button></div>
          <div class="tb-name-new"><input id="${id}-n" value="${esc(sp.nume)}" placeholder="${esc(t('pa_nume'))}"><input id="${id}-p" value="${esc(sp.prenume)}" placeholder="${esc(t('pa_prenume'))}">
            <button class="btn-ghost btn-sm" onclick="createFromSheetName('${esc(n.cheie)}','${id}')">${t('tb_jucatorNou')}</button></div>
        </div>`; }).join('') : `<div class="mini-empty">${t(s.loaded ? 'tb_numeNiciunul' : 'st_loading2')}</div>`}
      ${linked.length ? `<details class="tb-linked" ${s.showLinked?'open':''} ontoggle="tabelState.showLinked=this.open">
        <summary>${t('tb_legate')(linked.length)}</summary>
        <div class="table-scroll"><table><thead><tr><th>${t('tb_inTabel')}</th><th>${t('tb_inRegistru')}</th><th>${t('th_statut')}</th><th></th></tr></thead><tbody>
          ${linked.map(n=>`<tr><td>${esc(n.nume)}</td><td class="td-name" onclick="openProfile('${n.participant_id}')">${esc(participantName(n.participant_id))}</td>
            <td><span class="badge ${n.status==='auto'?'muted':'green'}">${t('tb_st_'+n.status)}</span></td>
            <td class="row-actions"><button class="btn-ghost btn-sm" onclick="relinkSheetName('${esc(n.cheie)}')">${t('tb_schimba')}</button></td></tr>`).join('')}
        </tbody></table></div>
      </details>` : ''}
    </div>
  </div>`;
}
async function copyText(v){ try { await navigator.clipboard.writeText(v); } catch(e){} }
async function newTabelKey(replacing){
  if(replacing && !confirm(t('tb_confirmCheieNoua'))) return;
  const { error } = await sb.rpc('seteaza_tabel_config', { p_url:null, p_cheie_noua:true });
  if(error){ alert(t('err_update')+' '+error.message); return; }
  tabelState.showKey = true;
  await loadTabelState();
}
async function saveTabelUrl(){
  const url = document.getElementById('tb-url').value.trim();
  const { error } = await sb.rpc('seteaza_tabel_config', { p_url:url||null, p_cheie_noua:false });
  if(error){ alert(error.message); return; }
  await loadTabelState();
}
async function linkSheetName(cheie, fieldId){
  const pid = document.getElementById(fieldId)?.value;
  if(!pid){ alert(t('tb_alegeJucator')); return; }
  const { error } = await sb.rpc('rezolva_jucator_tabel', { p_cheie:cheie, p_participant_id:pid });
  if(error){ alert(t('err_update')+' '+error.message); return; }
  await afterNameResolved();
}
async function createFromSheetName(cheie, fieldId){
  const nume = document.getElementById(fieldId+'-n').value.trim(), prenume = document.getElementById(fieldId+'-p').value.trim();
  if(!nume || !prenume){ alert(t('tb_numePrenume')); return; }
  if(!confirm(t('tb_confirmNou')(`${nume} ${prenume}`))) return;
  const { error } = await sb.rpc('rezolva_jucator_tabel', { p_cheie:cheie, p_participant_id:null, p_nume:nume, p_prenume:prenume });
  if(error){ alert(t('err_save')+' '+error.message); return; }
  await afterNameResolved(true);
}
function relinkSheetName(cheie){
  const n = tabelState.names.find(x=>x.cheie===cheie); if(!n) return;
  // reuse the confirm row: put it back in the pending list locally, prefilled with the current link
  n.propunere_id = n.participant_id; n.status = 'in_asteptare';
  render();
  document.getElementById('tabel-google')?.scrollIntoView({ block:'start' });
}
async function afterNameResolved(created){
  if(created) await fetchAll();
  await loadTabelState();
  // the waiting line-ups only need this name — pull them in right away when the sheet is connected
  if(tabelState.cfg?.activ && !tabelState.names.some(n=>n.status==='in_asteptare')) await runSheetSync(false, true);
}
async function runSheetSync(dryRun, quiet){
  if(tabelState.busy) return null;
  tabelState.busy = true; render();
  const { data, error } = await sb.functions.invoke('sheet-sync', { body:{ dryRun:!!dryRun } });
  tabelState.busy = false;
  if(error || data?.error){ alert(t('tb_eroare')+' '+(data?.error || error?.message || '')); render(); return null; }
  if(!dryRun){
    // the sheet may change matches, line-ups, ratings, teams and add players: reload it all, then reopen this tab
    await fetchAll();
    await Promise.all([loadTabelState(), loadSyncMeta()]);
  }
  if(!quiet) showSyncReport(data, dryRun);
  navigate(currentView);
  return data;
}
function showSyncReport(d, dryRun){
  const list = (k, fmt) => (d[k]||[]).length ? `<div class="tb-rep-sec"><div class="tb-rep-title">${t('tb_r_'+k)} <span class="badge muted">${d[k].length}</span></div>
    <ul>${d[k].slice(0,40).map(x=>`<li>${fmt(x)}</li>`).join('')}${d[k].length>40?`<li class="td-muted">… ${d[k].length-40}</li>`:''}</ul></div>` : '';
  const arr = v => Array.isArray(v) ? v.join(', ') : (v ?? '—');
  document.getElementById('record-modal-title').textContent = t(dryRun ? 'tb_raportSimulare' : 'tb_raport');
  document.getElementById('record-modal-body').innerHTML = `
    ${dryRun ? `<div class="alert-note">${t('tb_simulareNota')}</div>` : ''}
    <div class="tb-rep-stats"><div><b>${d.gasite??0}</b><span>${t('tb_meciuriTabel')}</span></div><div><b>${d.inserate??0}</b><span>${t('tb_noi')}</span></div>
      <div><b>${d.actualizate??0}</b><span>${t('tb_actualizate')}</span></div><div><b>${(d.schimbari||[]).filter(x=>x.lot).length}</b><span>${t('tb_loturiSchimbate')}</span></div></div>
    ${list('nume_noi', x=>`<b>${esc(x.nume)}</b> · ${esc(x.echipa||'—')}${x.propunere?` → ${esc(x.propunere)} (${Math.round(x.scor*100)}%)`:''}`)}
    ${list('conflicte', x=>`${x.nr?'#'+x.nr+' ':''}${esc(x.jucator||x.echipa||'')} — ${t('tb_aplicatia')}: <b>${esc(arr(x.aplicatie))}</b> · ${t('tb_tabelul')}: <b>${esc(arr(x.tabel))}</b>`)}
    ${list('blocate', x=>`#${x.nr} · ${fmtDate(x.data)} — ${esc(x.motiv)}`)}
    ${list('loturi_in_asteptare', x=>`#${x.nr??'—'} · ${fmtDate(x.data)} ${esc(x.ora)} · ${esc(x.echipa)}: ${esc(arr(x.nume))}`)}
    ${list('schimbari', x=>x.lot ? `#${x.nr} ${esc(x.lot)}: ${esc(arr(x.dupa))}` : x.jucator ? `${esc(x.jucator)}${x.rating?` · ★ ${esc(x.rating)}`:''}${x.echipa?` · ${esc(x.echipa)}`:''}` : x.nou ? `#${x.nr} ${t('tb_nou')}: ${esc(x.nou)} ${x.scor?esc(x.scor):''}` : `#${x.nr}: ${esc(x.inainte)} → ${esc(x.dupa)}`)}
    ${list('echipe_necunoscute', x=>esc(x))}
    ${list('erori', x=>esc(x))}
    <div class="profile-edit-actions"><button type="button" class="btn-primary" onclick="closeModal('record-modal')">${t('tb_inchide')}</button></div>`;
  openModal('record-modal');
}

/* ── Setări → linkuri de înregistrare (doar administrator) ── */
let invitesState = { list:null, loading:false, link:null, copied:false };
async function loadInvitatii(){
  if(invitesState.loading) return;
  invitesState.loading = true;
  const { data, error } = await sb.from('invitatii').select('id,rol,limba,creat_de,creat_la,expira_la,folosita_la,anulata_la,email,nume_afisat').order('creat_la', { ascending:false }).limit(50);
  invitesState.loading = false;
  invitesState.list = error ? [] : (data||[]);
  if(currentView==='setari') render();
}
function invitatieStatus(i){
  if(i.folosita_la) return { cls:'green', key:'st_inv_folosita' };
  if(i.anulata_la) return { cls:'muted', key:'st_inv_anulata' };
  if(new Date(i.expira_la) <= new Date()) return { cls:'muted', key:'st_inv_expirata' };
  return { cls:'gold', key:'st_inv_activa' };
}
function renderInvitatii(){
  if(invitesState.list===null && !invitesState.loading && !ICON_PREVIEW_MODE) loadInvitatii();
  const list = invitesState.list || [];
  const roleLabel = r => t(r==='admin' ? 'st_inv_rolAdminScurt' : 'st_inv_rolAsistentScurt');
  return `<div class="add-form">
    <div class="form-title">${t('st_inv_title')}</div>
    <div class="view-sub" style="margin:-4px 0 14px">${t('st_inv_sub')}</div>
    <div class="form-grid" style="grid-template-columns:1.4fr .7fr .7fr auto">
      <div class="field"><label>${t('st_inv_rol')}</label><select id="stf-inv-rol">
        <option value="asistent">${t('st_inv_rolAsistent')}</option><option value="admin">${t('st_inv_rolAdmin')}</option></select></div>
      <div class="field"><label>${t('st_inv_limba')}</label><select id="stf-inv-limba">
        <option value="ro" ${LANG==='ro'?'selected':''}>Română</option><option value="ru" ${LANG==='ru'?'selected':''}>Русский</option></select></div>
      <div class="field"><label>${t('st_inv_zile')}</label><select id="stf-inv-zile">
        ${[1,3,7,14,30].map(z=>`<option value="${z}" ${z===7?'selected':''}>${z} ${plural(z,'pa_expiraLa')}</option>`).join('')}</select></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" onclick="createInvitatie()">${t('st_inv_btn')}</button></div>
    </div>
    ${invitesState.link ? `<div class="invite-link-box">
      <div class="invite-link-row"><input id="stf-inv-link" readonly value="${esc(invitesState.link)}" onclick="this.select()">
        <button class="btn-primary" onclick="copyInvitatie()">${t(invitesState.copied ? 'st_inv_copied' : 'st_inv_copy')}</button></div>
      <div class="invite-link-note">${t('st_inv_once')}</div>
    </div>` : ''}
    <div class="table-scroll" style="margin-top:16px"><table><thead><tr><th>${t('st_inv_thCreat')}</th><th>${t('st_inv_rol')}</th><th>${t('st_inv_thExpira')}</th><th>${t('th_statut')}</th><th>${t('st_inv_thCont')}</th><th></th></tr></thead><tbody>
      ${invitesState.loading && !list.length ? `<tr><td class="td-empty" colspan="6">${t('st_loading2')}</td></tr>`
        : list.length ? list.map(i=>{ const st = invitatieStatus(i);
          return `<tr><td class="td-muted">${fmtDateTime(i.creat_la)}</td><td>${roleLabel(i.rol)} <span class="td-muted">· ${i.limba.toUpperCase()}</span></td>
            <td class="td-muted">${fmtDateTime(i.expira_la)}</td><td><span class="badge ${st.cls}">${t(st.key)}</span></td>
            <td>${i.folosita_la ? `${esc(i.nume_afisat||'')} <span class="td-muted">${esc(i.email||'')}</span>` : '<span class="td-muted">—</span>'}</td>
            <td class="row-actions">${st.key==='st_inv_activa' ? `<button class="btn-danger btn-sm" onclick="cancelInvitatie('${i.id}')">${t('st_inv_anuleaza')}</button>` : ''}</td></tr>`; }).join('')
        : `<tr><td class="td-empty" colspan="6">${t('st_inv_none')}</td></tr>`}
    </tbody></table></div>
  </div>`;
}
async function createInvitatie(){
  const p_rol = document.getElementById('stf-inv-rol').value;
  const p_limba = document.getElementById('stf-inv-limba').value;
  const p_zile = Number(document.getElementById('stf-inv-zile').value);
  if(p_rol==='admin' && !confirm(t('st_inv_confirmAdmin'))) return;
  const { data, error } = await sb.rpc('creeaza_invitatie', { p_rol, p_zile, p_limba });
  if(error || !data?.length){ alert(t('err_save')+' '+(error?.message||'')); return; }
  invitesState.link = `${PUBLIC_APP_URL}#invitatie=${data[0].token}${p_limba==='ru' ? '&lang=ru' : ''}`;
  invitesState.copied = false;
  invitesState.list = null;
  render();
}
async function copyInvitatie(){
  const input = document.getElementById('stf-inv-link'); if(!input) return;
  try { await navigator.clipboard.writeText(input.value); } catch(e){ input.select(); document.execCommand('copy'); }
  invitesState.copied = true;
  render();
}
async function cancelInvitatie(id){
  if(!confirm(t('st_inv_confirmAnulare'))) return;
  const { error } = await sb.rpc('anuleaza_invitatie', { p_id:id });
  if(error){ alert(t('err_update')+' '+error.message); return; }
  invitesState.list = null;
  render();
}
function renderSetari(){
  return `
  <div class="view-head"><div class="view-title">${t('st_title')}</div></div>
  <div class="view-sub">${t('st_sub')}</div>

  ${renderTabelGoogle()}

  <div class="table-wrap">
    <div class="table-header"><div class="table-title">${t('st_admins')}</div></div>
    <div class="table-scroll"><table><thead><tr><th>${t('pa_nume')}</th><th>${t('st_rol')}</th></tr></thead><tbody>
      ${visibleAdmins().map(a=>`<tr><td>${esc(adminName(a))}${a.id===currentAdminId?` <span class="badge gold">${t('st_activAcum')}</span>`:''}</td><td class="td-muted">${a.rol==='admin'?t('st_rolValue'):a.rol==='asistent'?t('as_rol'):t('st_rolLocatieCont')}</td></tr>`).join('')}
    </tbody></table></div>
  </div>

  ${renderInvitatii()}

  <div class="add-form">
    <div class="form-title">${t('st_praguri')}</div>
    <div class="profile-grid">
      <div><div class="k">${t('st_p_medAlerta')}</div><div class="v">${t('st_p_medAlertaV')}</div></div>
      <div><div class="k">${t('st_p_medVal')}</div><div class="v">${t('st_p_medValV')}</div></div>
      <div><div class="k">${t('st_p_sarciniRest')}</div><div class="v">${t('st_p_sarciniRestV')}</div></div>
      <div><div class="k">${t('st_p_intarzieri')}</div><div class="v">${t('st_p_intarzieriV')}</div></div>
      <div><div class="k">${t('st_p_inactiv')}</div><div class="v">${t('st_p_inactivV')}</div></div>
    </div>
  </div>

  ${renderSetariBskt()}

  <div class="add-form">
    <div class="form-title">${t('st_pinLocatie')}</div>
    <div class="view-sub" style="margin:-4px 0 14px">${t('st_pinLocatieSub')}</div>
    <div class="form-grid" style="grid-template-columns:1fr auto">
      <div class="field"><label>${t('st_pinNou')}</label><input id="stf-pin" type="password" inputmode="numeric" placeholder="${t('au_pinPh')}"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn-primary" onclick="rotateLocatiePin()">${t('st_pinSchimba')}</button></div>
    </div>
    <div class="auth-hint" id="stf-pin-msg" style="text-align:left;margin-top:8px"></div>
  </div>

  <div class="table-wrap">
    <div class="table-header"><div class="table-title">${t('st_trustedIps')}</div></div>
    <div class="view-sub" style="padding:0 20px;margin:8px 0 0">${t('st_trustedIpsSub')}</div>
    <div class="add-form" style="border:none;box-shadow:none;padding:14px 20px">
      <div class="form-grid" style="grid-template-columns:1fr 1fr auto">
        <div class="field"><label>${t('st_ipAddr')}</label><input id="stf-ip" placeholder="${t('st_ipAddrPh')}"></div>
        <div class="field"><label>${t('st_ipEticheta')}</label><input id="stf-ip-eticheta" placeholder="${t('st_ipEtichetaPh')}"></div>
        <div class="field" style="justify-content:flex-end"><button class="btn-primary" onclick="addTrustedIp()">${t('st_ipAdauga')}</button></div>
      </div>
    </div>
    <div class="table-scroll"><table>
      <thead><tr><th>${t('st_ipAddr')}</th><th>${t('st_ipEticheta')}</th><th>${t('th_data')}</th><th></th></tr></thead>
      <tbody>${DB.trustedIps.length ? DB.trustedIps.map(ip=>`
        <tr><td class="td-name">${esc(ip.ip)}</td><td class="td-muted">${esc(ip.eticheta)||'—'}</td><td class="td-muted">${fmtDate(String(ip.createdAt).slice(0,10))}</td>
        <td><button class="btn-danger" onclick="removeRow('trusted_ips','${ip.id}')">${t('btn_delete')}</button></td></tr>`).join('') : `<tr><td class="td-empty" colspan="4">${t('st_ipNone')}</td></tr>`}</tbody>
    </table></div>
  </div>

  <div class="table-wrap">
    <div class="table-header">
      <div class="table-title">${t('st_jurnalTitle')}</div>
    </div>
    <div class="table-scroll recent-actions-scroll"><table>
      <thead><tr><th>${t('th_cont')}</th><th>${t('th_data')}</th><th>${t('th_actiune')}</th></tr></thead>
      <tbody>${DB.jurnal.slice(0,100).map(j=>`<tr><td class="td-muted">${esc(j.cont)}</td><td class="td-muted">${fmtDate(j.data)}</td><td>${esc(j.actiune)}</td></tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}
async function addTrustedIp(){
  const ip = document.getElementById('stf-ip').value.trim();
  if(!ip) return;
  const eticheta = document.getElementById('stf-ip-eticheta').value.trim() || null;
  const { data, error } = await sb.from('trusted_ips').insert({ ip, eticheta, adaugat_de: currentAdminId }).select().single();
  if(error){ alert('Salvarea a eșuat: ' + error.message); return; }
  DB.trustedIps.unshift({ id:data.id, ip:data.ip, eticheta:data.eticheta, createdAt:data.created_at });
  await logAction(`A autorizat adresa IP ${ip} pentru contul de locație${eticheta?` (${eticheta})`:''}`);
  render();
}
async function rotateLocatiePin(){
  const pin = document.getElementById('stf-pin').value.trim();
  const msg = document.getElementById('stf-pin-msg');
  if(pin.length < 4){ msg.textContent = t('st_pinTooShort'); msg.style.color = 'var(--red)'; return; }
  const { error } = await sb.rpc('set_locatie_pin', { nou_pin: pin });
  if(error){ msg.textContent = 'Eroare: ' + error.message; msg.style.color = 'var(--red)'; return; }
  document.getElementById('stf-pin').value = '';
  msg.textContent = t('st_pinSchimbat');
  msg.style.color = 'var(--green)';
  await logAction('A schimbat PIN-ul contului de locație');
}

/* ══════════════════════ INIT ══════════════════════ */
document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ closeModal('profile-modal'); closeModal('arbitru-modal'); closeModal('act-modal'); closeModal('team-modal'); } });

let iconEnhanceFrame = 0;
const iconObserver = new MutationObserver(()=>{
  cancelAnimationFrame(iconEnhanceFrame);
  iconEnhanceFrame = requestAnimationFrame(()=>enhanceIcons(document));
});
iconObserver.observe(document.getElementById('app-shell'), { childList:true, subtree:true });
enhanceIcons(document);

// Local-only review mode for the icon redesign. It never authenticates, fetches,
// writes, or subscribes to Supabase; it only renders representative mock content.
function startIconPreview(){
  const today=todayISO();
  currentAdminId='icon-preview-admin';
  currentAdmin='Previzualizare iconuri';
  currentRole=new URLSearchParams(location.search).get('role')==='asistent' ? 'asistent' : 'admin';
  adminDemoShiftActive=false;
  DB={
    administratori:[{id:currentAdminId,nume:'Previzualizare',prenume:'Iconuri',rol:'admin',ascuns:false}],
    serviciuAdministratori:[{id:'employee-1',nume:'Ahmetzeanov Rustam'}],
    participanti:[
      {id:'p1',nrDulap:'12',nume:'Exemplu',prenume:'Participant',dataNasterii:'1995-04-12',adresa:'Chișinău',telefon:'+373 60 000 000',email:'',dataAvizMedical:addDays(today,4),marime:'M',categorieSportiva:'Seniori',statut:'activ',dataInregistrarii:today,eligibilAntrenament:true},
      {id:'p2',nrDulap:'27',nume:'Model',prenume:'Sportiv',dataNasterii:'2001-09-18',adresa:'Chișinău',telefon:'+373 69 000 000',email:'',dataAvizMedical:addDays(today,90),marime:'L',categorieSportiva:'Tineret',statut:'activ',dataInregistrarii:today,eligibilAntrenament:true},
    ],
    arbitri:[{id:'a1',nrDulap:'A1',nume:'Arbitru',prenume:'Exemplu',statut:'activ',dataInregistrarii:today}],
    intarzieri:Array.from({length:14},(_,index)=>({
      id:`late-${index}`, participantId:index%2?'p1':'p2', arbitru:null, data:addDays(today,-index),
      minuteIntarziere:5+(index%4)*5, motiv:index%3===0?'Transport':'Motiv demonstrativ', createdAt:new Date().toISOString(),
    })),
    vestimentatie:[],
    serviciu:Array.from({length:14},(_,index)=>{
      const data=addDays(today,-index);
      return {id:`service-${index}`,data,administratorServiciuId:'employee-1',administratorId:null,
        inceputLa:`${data}T06:45:00+03:00`,sfarsitLa:`${data}T14:30:00+03:00`,administrator:'Ahmetzeanov Rustam'};
    }),
    spalatorie:[],
    hostel:Array.from({length:14},(_,index)=>({
      id:`hostel-${index}`, participantId:index%2?'p1':'p2', dataCazare:addDays(today,-index),
      observatii:index%3===0?'Cazare demonstrativă':null, statut:index%4===0?'închis':'activ', createdAt:new Date().toISOString(),
    })),
    lenjerie:Array.from({length:14},(_,index)=>({
      id:`linen-${index}`, participantId:index%2?'p1':'p2', dataEliberare:addDays(today,-index),
      dataReturnare:index%3===0?addDays(today,-index+1):null, sursaStoc:index%2?'nou':'uzat',
    })),
    daune:[], fairPlay:[], arbitraj:[],
    inventar:[
      {id:'inv-m-m',denumire:'Maiouri',culoare:'—',marime:'M',um:'buc',cantitateInitiala:0,intrari:0,iesiri:0,cantitateMinima:0,stare:'bună',observatii:'',conditie:'nou'},
      {id:'i2',denumire:'Mingi baschet 3×3',culoare:'—',marime:'6',um:'buc',cantitateInitiala:20,intrari:0,iesiri:18,cantitateMinima:5,stare:'bună',observatii:'',conditie:'nou'},
    ],
    sarcini:[
      {id:'t1',dataInreg:today,adminInreg:'Ahmetzeanov Rustam',status:'nesoluționat',actiuni:'',dataSolutionare:null,adminSolutionare:'',descriere:'Verificare iluminare sală',createdAt:new Date().toISOString()},
      {id:'t2',dataInreg:addDays(today,-1),adminInreg:'Sobietki Rostislav',status:'în lucru',actiuni:'',dataSolutionare:null,adminSolutionare:'',descriere:'Înlocuire plasă coș',createdAt:new Date().toISOString()},
      ...Array.from({length:14},(_,index)=>({
        id:`ts-${index}`, dataInreg:addDays(today,-index-2), adminInreg:'Ahmetzeanov Rustam', status:'soluționat', actiuni:'',
        dataSolutionare:addDays(today,-index-1), adminSolutionare:'Ahmetzeanov Rustam', descriere:`Sarcină soluționată — exemplul ${index+1}`, createdAt:new Date().toISOString(),
      })),
    ],
    observatii:Array.from({length:14},(_,index)=>({
      id:`observation-${index}`, data:addDays(today,-index), participantId:index%3===0?null:(index%2?'p1':'p2'),
      subiect:index%3===0?'Locație':null, categorie:OBS_CATEGORIES[index%OBS_CATEGORIES.length],
      descriere:`Observație demonstrativă ${index+1}`, createdAt:new Date().toISOString(),
    })),
    pauzeTehnice:[], trustedIps:[], treninguri:[],
    acteSchimb:Array.from({length:14},(_,index)=>({
      id:`report-${index}`, data:addDays(today,-index), numeAdministrator:index%2?'Ahmetzeanov Rustam':'Sobietki Rostislav',
      sesiuneSchimbId:`preview-shift-${index}`, createdAt:new Date().toISOString(), inceputPerioada:null, sfarsitPerioada:null, continut:{},
    })),
    jurnal:[
      {id:'j1',cont:'Ahmetzeanov Rustam',data:today,actiune:'A început schimbul de locație'},
      {id:'j2',cont:'Sobietki Rostislav',data:today,actiune:'A înregistrat o sarcină'},
    ],
  };
  // BSKT preview data: teams, line-ups and results computed locally (no Supabase calls)
  const pv = (id,nume,prenume,echipaId,nr,rol,rating)=>mapParticipant({id,nume,prenume,echipa_id:echipaId,nr_echipa:nr,rol_echipa:rol,rating,statut:'activ',data_aviz_medical:addDays(today,-30),telefon:'+373 60 000 000',club:'BAM-BASKET',marime:'XL',inaltime_cm:188,greutate_kg:84,categorie_sportiva:'CMS',idnp:'2000000000000',primul_antrenor:'Exemplu Antrenor'});
  const LOGO='https://cdn.prod.website-files.com/6aac35930b4576c7ef33dd53/';
  DB.echipe=[{id:'e1',nume:'Orbit Basket',culoare:'#f7931e',activ:true,logoUrl:LOGO+'6ab429b5ab794c482e68263a_Orbit%20Basket.svg'},
    {id:'e2',nume:'District Kings',culoare:'#5971fc',activ:true,logoUrl:LOGO+'6ab426c973aa77feee11accb_District%20Kings.svg'},
    {id:'e3',nume:'Runners',culoare:'#09703f',activ:true,logoUrl:LOGO+'6ab429c9ed6f77cf39bb30ef_Rim%20Runners.svg'}];
  DB.participanti=[
    pv('p1','Exemplu','Căpitan','e1',1,'căpitan',99), pv('p2','Model','Sportiv','e1',2,'jucător',80), pv('p3','Test','Unu','e1',3,'jucător',75), pv('p4','Test','Doi','e1',4,'jucător',60),
    pv('p5','Demo','Lider','e2',1,'căpitan',92), pv('p6','Demo','Unu','e2',2,'jucător',82), pv('p7','Demo','Doi','e2',3,'jucător',75), pv('p8','Demo','Trei','e2',4,'jucător',70),
    pv('p9','Probă','Căpitan','e3',1,'căpitan',90), pv('p10','Probă','Unu','e3',2,'jucător',85), pv('p11','Probă','Doi','e3',3,'jucător',80), pv('p12','Fără','Echipă',null,null,'jucător',null),
  ];
  DB.tarife=[['căpitan','victorie',185],['căpitan','înfrângere',135],['jucător','victorie',155],['jucător','înfrângere',105],['rezervă','victorie',155],['rezervă','înfrângere',105]]
    .map(([rol,situatie,net],i)=>({id:'t'+i,valabilDeLa:'2026-10-06',rol,situatie,net,retinerePct:15}));
  const pairs=[['e1','e2',21,18],['e3','e1',15,21],['e2','e3',20,19],['e1','e3',17,21],['e2','e1',12,21],['e3','e2',null,null]];
  DB.meciuri=pairs.map(([a,b,sa,sbv],i)=>({id:'m'+i,nr:213+i,data:today,ora:`18:${String(i*20%60).padStart(2,'0')}`,teren:'Teren 1',echipaAId:a,echipaBId:b,scorA:sa,scorB:sbv,prelungiri:false,sesiuneSchimbId:null,sursa:i>2?'bsktcup':'manual',idExtern:i>2?'preview-'+i:null}));
  const rate=(rol,won)=>DB.tarife.find(r=>r.rol===rol&&r.situatie===(won?'victorie':'înfrângere')).net;
  DB.meciuri.forEach(m=>{
    const w=winnerOf(m); const rows=[];
    [m.echipaAId,m.echipaBId].forEach(eid=>teamPlayers(eid).slice(0,4).forEach((p,i)=>{
      const rol=i===0?'căpitan':i===3?'rezervă':'jucător'; const net=w?rate(rol,w===eid):null;
      rows.push({id:m.id+p.id,meciId:m.id,echipaId:eid,participantId:p.id,rol,sumaNet:net,retinere:net==null?null:Math.round((net/0.85-net)*100)/100,sumaBruta:net==null?null:Math.round(net/0.85*100)/100});
    }));
    rosterByMatch.set(m.id,rows);
  });
  datesBetween(addDays(today,-60),addDays(today,7)).forEach(d=>rosterLoadedDays.add(d));
  DB.spalatorie=[{id:'s1',data:today,participantId:'p2',tipArticole:'Echipament',cantitate:1,suma:50,dataReturnare:null}];
  loadStats = async ()=>{
    const jm=new Map(), em=new Map();
    DB.meciuri.filter(m=>winnerOf(m)).forEach(m=>{
      [[m.echipaAId,m.scorA,m.scorB],[m.echipaBId,m.scorB,m.scorA]].forEach(([eid,pf,pa])=>{
        const e=em.get(eid)||{echipaId:eid,meciuri:0,victorii:0,infrangeri:0,marcate:0,primite:0}; e.meciuri++; pf>pa?e.victorii++:e.infrangeri++; e.marcate+=pf; e.primite+=pa; em.set(eid,e);
        rosterOf(m.id,eid).forEach(r=>{ const j=jm.get(r.participantId)||{participantId:r.participantId,meciuri:0,victorii:0,infrangeri:0,diff:0,meciuriCapitan:0,victoriiCapitan:0,meciuriRezerva:0,totalNet:0,totalRetinere:0,totalBrut:0,echipe:echipaName(eid)};
          j.meciuri++; pf>pa?j.victorii++:j.infrangeri++; j.diff+=pf-pa; if(r.rol==='căpitan'){j.meciuriCapitan++; if(pf>pa) j.victoriiCapitan++;} if(r.rol==='rezervă') j.meciuriRezerva++;
          j.totalNet+=r.sumaNet||0; j.totalRetinere+=r.retinere||0; j.totalBrut+=r.sumaBruta||0; jm.set(r.participantId,j); });
      });
    });
    return { jucatori:[...jm.values()].map(j=>({...j,winRate:j.victorii/j.meciuri,plusMinus:Math.round(j.diff/j.meciuri*10)/10})),
             echipe:[...em.values()].map(e=>({...e,winRate:e.victorii/e.meciuri,diferenta:Math.round((e.marcate-e.primite)/e.meciuri*10)/10})) };
  };
  photoUrl = async ()=>null;
  document.body.classList.remove('role-locatie');
  document.body.classList.toggle('role-asistent', isAsistent());
  if(isAsistent()){
    // same shape the participanti_asistent() RPC returns: sport fields only
    const keep=['id','nume','prenume','echipaId','nrEchipa','rolEchipa','rating','categorieSportiva','fotoPath','statut','eligibilAntrenament','dataInregistrarii','dataAvizMedical','nrDulap','marime','freelancer'];
    DB.participanti=DB.participanti.map(p=>Object.fromEntries(keep.map(k=>[k,p[k]])));
    DB.acteSchimb=[]; DB.jurnal=[];
    DB.arbitri=DB.arbitri.map(a=>({ id:a.id, nume:a.nume, prenume:a.prenume, statut:a.statut, dataInregistrarii:a.dataInregistrarii, freelancer:a.freelancer!==false }));
  }
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('app-shell').classList.add('visible');
  document.getElementById('header-user').textContent=currentAdmin;
  document.getElementById('sb-admin').textContent=currentAdmin;
  buildSidebar();
  const previewView=new URLSearchParams(location.search).get('view');
  navigate(NAV.some(item=>item.id===previewView) ? previewView : 'dashboard');
}
/* ── Phones: every table in the page becomes a stack of cards (CSS in app.css, ≤680px).
   Each cell gets its column heading as data-label so the card can show "label  value";
   cells spanning several columns (group headings, detail panels, empty states) span the card. ── */
/* Phones: data-entry forms start folded into their title bar so the list is visible straight away;
   a form the user opened stays open across redraws (remembered per page + title). */
const openMobileForms = new Set();
function foldEntryForms(root){
  root.querySelectorAll('.add-form').forEach(form=>{
    const title = form.querySelector(':scope > .form-title');
    if(!title || !form.querySelector('input:not([type=hidden]),select,textarea')) return;
    const key = currentView + '|' + title.textContent.trim();
    form.classList.add('m-fold');
    form.classList.toggle('m-open', openMobileForms.has(key));
    if(title.dataset.fold) return;
    title.dataset.fold = '1';
    title.setAttribute('role', 'button');
    title.tabIndex = 0;
    const toggle = ()=>{ const open = !form.classList.contains('m-open'); form.classList.toggle('m-open', open); open ? openMobileForms.add(key) : openMobileForms.delete(key); title.setAttribute('aria-expanded', open); };
    title.addEventListener('click', toggle);
    title.addEventListener('keydown', e=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); toggle(); } });
  });
}
function labelTables(root){
  root.querySelectorAll('table').forEach(table=>{
    const head = table.tHead?.rows[table.tHead.rows.length-1];
    const labels = [];
    if(head) [...head.cells].forEach(th=>{ const txt = th.innerText.replace(/\s+/g,' ').trim(); for(let i=0;i<(th.colSpan||1);i++) labels.push(txt); });
    table.classList.add('m-cards');
    [...table.tBodies, ...(table.tFoot ? [table.tFoot] : [])].forEach(sec=>[...sec.rows].forEach(tr=>{
      let col = 0;
      [...tr.cells].forEach(td=>{
        const span = td.colSpan||1;
        if(span>1 || tr.cells.length===1) td.classList.add('m-full');
        else td.dataset.label = labels[col] || '';
        col += span;
      });
    }));
  });
}
{
  let pending = false;
  const run = ()=>{ pending = false; const main = document.getElementById('main'); if(main){ labelTables(main); foldEntryForms(main); } };
  new MutationObserver(()=>{ if(!pending){ pending = true; setTimeout(run, 0); } })
    .observe(document.getElementById('main'), { childList:true, subtree:true });
}
if(ICON_PREVIEW_MODE) startIconPreview();
