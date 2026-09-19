// Mobile menu: a side sheet that slides in from the right over a scrim, under
// the header, with the page behind it locked (same behaviour as mttf.md).
// Open/closed is a class rather than display:none, which cannot be transitioned;
// visibility carries the delay so the sheet leaves the tab order once it has slid away.
(function(){
  const toggle = document.getElementById('navToggle');
  const sheet = document.getElementById('mobileNav');
  if (!toggle || !sheet) return;
  const root = document.documentElement;
  const bar = document.querySelector('.topbar');
  const tr = s => (typeof t === 'function' ? t(s) : s);

  // three bars that fold into an X, so the one button opens and closes the sheet
  toggle.innerHTML = '<span></span><span></span><span></span>';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'mobileNav');
  sheet.setAttribute('tabindex', '-1');

  // social links at the foot of the sheet, one tap from anywhere on the site
  const SOCIAL = [
    ['Facebook', 'https://www.facebook.com/profile.php?id=61565205231697', '#4C8DF6', '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 8.5V6.8c0-.8.5-1 .9-1H17V2.1L14.1 2C10.8 2 10 4.5 10 6.1v2.4H8v3.9h2V22h4v-9.6h2.8l.4-3.9H14z"/></svg>'],
    ['Instagram', 'https://www.instagram.com/attpmoldova/', '#E1306C', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>'],
    ['TikTok', 'https://www.tiktok.com/@attp.md', '#25F4EE', '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.3v13.2a2.7 2.7 0 1 1-2.7-2.7c.3 0 .5 0 .8.1V10.2a6 6 0 0 0-.8-.1 6 6 0 1 0 6 6V9.5a7.6 7.6 0 0 0 4.5 1.4V7.6a4.3 4.3 0 0 1-3.4-1.8z"/></svg>'],
    ['YouTube', 'https://www.youtube.com/@ATTPMoldova', '#FF3B30', '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8zM9.7 15.1V8.9l5.8 3.1-5.8 3.1z"/></svg>'],
  ];
  const social = document.createElement('div');
  social.className = 'mobile-social';
  social.innerHTML = `<p class="mobile-social-title">${tr('Urmărește ATTP')}</p><div class="mobile-social-row">` +
    SOCIAL.map(([name, href, color, icon]) =>
      `<a href="${href}" target="_blank" rel="noopener" aria-label="${name}" style="--brand:${color}">${icon}<span>${name}</span></a>`).join('') +
    '</div>';
  sheet.append(social);

  const scrim = document.createElement('div');
  scrim.className = 'nav-scrim';
  sheet.before(scrim);

  let lastFocus = null;
  const setOpen = open => {
    // the sheet and scrim start under the header, whatever height it has right now
    if (bar) root.style.setProperty('--barh', bar.getBoundingClientRect().bottom + 'px');
    sheet.classList.toggle('show', open);
    scrim.classList.toggle('show', open);
    root.classList.toggle('nav-open', open);
    toggle.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', tr(open ? 'Închide meniul' : 'Deschide meniul'));
    if (open) { lastFocus = document.activeElement; sheet.focus({ preventScroll:true }); }
    else if (lastFocus) { lastFocus.focus({ preventScroll:true }); lastFocus = null; }
  };
  const isOpen = () => sheet.classList.contains('show');

  toggle.addEventListener('click', () => setOpen(!isOpen()));
  document.getElementById('navClose')?.addEventListener('click', () => setOpen(false));
  scrim.addEventListener('click', () => setOpen(false));
  sheet.addEventListener('click', e => { if (e.target.closest('a')) setOpen(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) setOpen(false); });
  // overflow:hidden does not stop iOS Safari from scrolling the page, so a drag
  // that did not start inside the sheet is cancelled while it is open
  document.addEventListener('touchmove', e => {
    if (isOpen() && !sheet.contains(e.target)) e.preventDefault();
  }, { passive:false });
  addEventListener('resize', () => { if (innerWidth > 980 && isOpen()) setOpen(false); }, { passive:true });
})();
