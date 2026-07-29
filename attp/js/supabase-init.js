// ATTP — shared Supabase client + data helpers, used across every page.
const SUPA_URL = 'https://bghrgacqcqwdiqegkowd.supabase.co';
const SUPA_KEY = 'sb_publishable_-Sj5r66svI88A0Hm9nTvIA_hiEHqay7';
const db = supabase.createClient(SUPA_URL, SUPA_KEY);

const MONTHS_RO = ['ianuarie','februarie','martie','aprilie','mai','iunie','iulie','august','septembrie','octombrie','noiembrie','decembrie'];

function fmtDate(iso){
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS_RO[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtDateShort(iso){
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
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
  const url = `images/${context === 'team' ? 'team' : 'players'}/${personImageSlug(p)}.webp`;
  const fallback = setkaPhotoUrl(token, size === 'lg' ? '280x280' : '90x90');
  const initials = (p.first_name[0]+p.last_name[0]).toUpperCase();
  const onerror = fallback
    ? `this.onerror=function(){this.parentElement.textContent='${initials}'};this.src='${fallback}'`
    : `this.parentElement.textContent='${initials}'`;
  return `<img src="${url}" alt="" loading="lazy" onerror="${onerror}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`;
}
function playerStats(p){
  const c = p.setka_cup_cache;
  if (c && c.rating_sc != null) {
    return { rating: c.rating_sc, tournaments: c.total_tournaments, matches: c.total_matches, wins: c.wins, losses: c.losses, live: true };
  }
  if (p.attp_total_matches != null && (p.attp_total_matches > 0 || p.attp_rating_sc != null)) {
    return { rating: p.attp_rating_sc, tournaments: p.attp_total_tournaments, matches: p.attp_total_matches, wins: p.attp_win_matches, losses: p.attp_total_matches - p.attp_win_matches, live: false };
  }
  return null;
}
function roleLabel(role){
  return { founder:'Fondator', president:'Președinte', management:'Management', coach:'Antrenor', referee:'Arbitru', player:'Jucător' }[role] || role;
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
  const { data, error } = await db.from('players').select('*, setka_cup_cache(*)').contains('roles', ['player']).order('last_name');
  if (error) { console.error(error); return []; }
  return data || [];
}
async function fetchTopRanked(limit = 10){
  const { data, error } = await db.from('players')
    .select('*, setka_cup_cache!inner(*)')
    .order('sort_order')
    .limit(200);
  if (error) { console.error(error); return []; }
  return (data || [])
    .filter(p => p.setka_cup_cache && p.setka_cup_cache.rating_sc != null)
    .sort((a,b) => b.setka_cup_cache.rating_sc - a.setka_cup_cache.rating_sc)
    .slice(0, limit);
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

  return [...bySlug.values()]
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
