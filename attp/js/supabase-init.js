// ATTP — shared Supabase client + data helpers, used across every page.
const SUPA_URL = 'https://bghrgacqcqwdiqegkowd.supabase.co';
const SUPA_KEY = 'sb_publishable_-Sj5r66svI88A0Hm9nTvIA_hiEHqay7';
const db = supabase.createClient(SUPA_URL, SUPA_KEY);

const MONTHS_RO = ['ianuarie','februarie','martie','aprilie','mai','iunie','iulie','august','septembrie','octombrie','noiembrie','decembrie'];

const DATE_LOCALE = { ro:'ro-RO', en:'en-GB', ru:'ru-RU' };
function fmtDate(iso){
  const d = new Date(iso);
  if ((window.ATTP_LANG || 'ro') === 'ro') return `${d.getDate()} ${MONTHS_RO[d.getMonth()]} ${d.getFullYear()}`;
  return d.toLocaleDateString(DATE_LOCALE[window.ATTP_LANG], { day:'numeric', month:'long', year:'numeric' }).replace(/\s?г\.$/, '');
}
function fmtDateShort(iso){
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}
function divisionLabel(d){
  return d === 'man' ? t('Bărbați') : d === 'woman' ? t('Femei') : (d || '');
}
function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function setkaPhotoUrl(token, size){
  if (!token) return null;
  return `https://tabletennis.setkacup.com/api/Image/setka/${size || '180x180'}/${token}.jpeg`;
}
function personImageSlug(p){
  return `${p.first_name}-${p.last_name}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ș/g, 's').replace(/ț/g, 't')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
function avatarHtml(p, size, context = 'player'){
  const token = p.setka_cup_cache?.photo_token;
  // Staff and competition portraits are deliberately separate. Some people
  // have both roles, so a single database photo_url must not choose the image
  // for every part of the site.
  let local;
  if (context === 'team') {
    local = `images/team/${personImageSlug(p)}.webp`;
  } else if (p.photo_url && p.photo_url.startsWith('images/players/')) {
    // Transparent portraits made by tools/player_photos.py (Setka original, background removed).
    local = p.photo_url;
  } else if (p.ligas_match_status !== 'created') {
    // Imported roster: the file is named after the player. Profiles auto-created from
    // ligas.io have no file unless one was recorded — guessing would 404 or pick a namesake.
    local = `images/players/${personImageSlug(p)}.webp`;
  }
  const chain = [local, setkaPhotoUrl(token, size === 'lg' ? '280x280' : '90x90')].filter(Boolean);
  const initials = escapeHtml((p.first_name[0]+p.last_name[0]).toUpperCase());
  if (!chain.length) return initials;
  return `<img src="${chain[0]}" data-next="${chain.slice(1).join('|')}" data-initials="${initials}" alt="" loading="lazy" onerror="avatarNext(this)" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`;
}
function avatarNext(img){
  const rest = (img.dataset.next || '').split('|').filter(Boolean);
  if (!rest.length) { img.parentElement.textContent = img.dataset.initials; return; }
  img.dataset.next = rest.slice(1).join('|');
  img.src = rest[0];
}
// The official FTMM ranking from ligas.io — the only source of rating and position.
function playerRanking(p){
  const r = Array.isArray(p.ligas_ranking) ? p.ligas_ranking[0] : p.ligas_ranking;
  return r ? { position: r.position, rating: Number(r.rating), list: r.ranking } : null;
}
// Rating/position from ligas.io; match and tournament counts from Setka Cup.
function playerStats(p){
  const r = playerRanking(p);
  const c = p.setka_cup_cache;
  let games = null;
  if (c && c.total_matches != null) {
    games = { tournaments: c.total_tournaments, matches: c.total_matches, wins: c.wins, losses: c.losses };
  } else if (p.attp_total_matches > 0) {
    games = { tournaments: p.attp_total_tournaments, matches: p.attp_total_matches, wins: p.attp_win_matches, losses: p.attp_total_matches - p.attp_win_matches };
  }
  if (!r && !games) return null;
  return { rating: r ? r.rating : null, position: r ? r.position : null, list: r ? r.list : null, ...(games || { tournaments:null, matches:null, wins:null, losses:null }) };
}
function roleLabel(role){
  const label = { founder:'Fondator', president:'Președinte', management:'Management', coach:'Antrenor', referee:'Arbitru', player:'Jucător' }[role];
  return label ? t(label) : role;
}

async function fetchRecentResults(limit = 6){
  const { data, error } = await db.from('tournament_results')
    .select('*')
    .eq('status', 'finished')
    .order('start_date', { ascending:false })
    .limit(limit);
  if (error) { console.error(error); return []; }
  return data || [];
}
async function fetchFeaturedPlayers(){
  const { data, error } = await db.from('players').select('*').eq('featured', true).order('sort_order');
  if (error) { console.error(error); return []; }
  return data || [];
}
async function fetchAllPlayers(){
  const { data, error } = await db.from('players').select('*, setka_cup_cache(*), ligas_ranking(ranking,position,rating)').contains('roles', ['player']).order('last_name');
  if (error) { console.error(error); return []; }
  return data || [];
}
async function fetchTopRanked(limit = 10, list = 'masculin'){
  const { data, error } = await db.from('ligas_ranking')
    .select('ranking, position, rating, players(*, setka_cup_cache(photo_token))')
    .eq('ranking', list)
    .order('position')
    .limit(limit);
  if (error) { console.error(error); return []; }
  return (data || [])
    .filter(r => r.players)
    .map(r => ({ ...r.players, ligas_ranking: [{ ranking: r.ranking, position: r.position, rating: r.rating }] }));
}
async function fetchNews(limit = 20){
  const localNews = [
    ...(window.ATTP_NEWS || []),
    ...(window.ATTP_NEWS_ARCHIVE || []),
  ].map(n => ({
    ...n,
    published_at: n.published_at || n.date,
    cover_image_url: n.cover_image_url || n.image || null,
  }));

  const { data, error } = await db.from('news').select('*').order('published_at', { ascending:false });
  if (error) console.error(error);

  const bySlug = new Map(localNews.map(n => [n.slug, n]));
  (data || []).forEach(n => {
    const local = bySlug.get(n.slug) || {};
    bySlug.set(n.slug, {
      ...local,
      ...n,
      image: n.cover_image_url || local.image ||
        (n.slug === 'noul-site-attp-este-live' ? 'images/news/noul-site-attp-este-live.webp' : null),
      cover_image_url: n.cover_image_url || local.cover_image_url ||
        (n.slug === 'noul-site-attp-este-live' ? 'images/news/noul-site-attp-este-live.webp' : null),
      date: n.published_at || local.date,
    });
  });

  // English/Russian pages: translated titles and excerpts from js/news-<lang>.js
  // (full bodies are fetched per article on news-article.html).
  const tr = window.ATTP_NEWS_T || {};
  return [...bySlug.values()]
    .map(n => {
      const x = tr[n.slug];
      return { ...n, tag: n.tag ? t(n.tag) : n.tag, translated: !!x || window.ATTP_LANG === 'ro', ...(x ? { title: x.title, excerpt: x.excerpt } : {}) };
    })
    .sort((a,b) => new Date(b.published_at || b.date) - new Date(a.published_at || a.date))
    .slice(0, limit);
}
async function fetchPartners(){
  const { data, error } = await db.from('partners').select('*').order('sort_order');
  if (error) { console.error(error); return []; }
  return data || [];
}
async function fetchDocuments(){
  const { data, error } = await db.from('documents').select('*').order('category').order('sort_order');
  if (error) { console.error(error); return []; }
  return data || [];
}
async function fetchGalleryAlbums(){
  const { data, error } = await db.from('gallery_albums').select('*, gallery_images(count)').order('sort_order');
  if (error) { console.error(error); return []; }
  return data || [];
}
async function fetchSiteSettings(){
  const { data, error } = await db.from('site_settings').select('*').single();
  if (error) { console.error(error); return {}; }
  return data || {};
}

// Mobile nav toggle — shared across every page.
document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('navToggle');
  const closeBtn = document.getElementById('navClose');
  const panel = document.getElementById('mobileNav');
  if (openBtn && panel) openBtn.addEventListener('click', () => panel.classList.add('show'));
  if (closeBtn && panel) closeBtn.addEventListener('click', () => panel.classList.remove('show'));
});
