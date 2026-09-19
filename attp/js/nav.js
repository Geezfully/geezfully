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
