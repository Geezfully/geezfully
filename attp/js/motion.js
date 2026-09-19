// ATTP — scroll polish: section reveal-on-scroll + sticky topbar state.
//
// Progressive enhancement: if this file never runs, `html` never gets the
// `reveal-ready` class and CSS leaves every .reveal element fully visible.
//
// Reveal uses a plain rAF-throttled viewport sweep rather than
// IntersectionObserver. With only a couple of dozen tracked elements the cost
// is negligible, and it avoids the failure mode where an IO callback never
// fires (throttled/background/embedded webviews) and leaves content stranded at
// opacity 0. A low-frequency safety sweep is the final backstop.
(function(){
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Sticky topbar: gains its (soft) seam only once the page has scrolled ── */
  const topbar = document.querySelector('.topbar');
  if (topbar) {
    let barTicking = false;
    const syncBar = () => {
      barTicking = false;
      topbar.classList.toggle('is-stuck', window.scrollY > 8);
    };
    syncBar();
    window.addEventListener('scroll', () => {
      if (barTicking) return;
      barTicking = true;
      requestAnimationFrame(syncBar);
    }, { passive:true });
  }

  if (reduced) return;

  /* ── Reveal on scroll ──
     Tag the direct children of each content section. Section *containers* are
     always present in the static HTML even when their contents arrive later
     from Supabase, so tagging at this level never races async rendering. */
  const skip = el =>
    el.id === 'loadScreen' ||
    el.hasAttribute('data-no-reveal') ||
    el.getAttribute('aria-hidden') === 'true' ||
    // Heroes run their own entrance choreography — don't double-animate them.
    /hero/i.test(typeof el.className === 'string' ? el.className : '') ||
    el.closest('[class*="hero"]') ||
    el.closest('#loadScreen') ||
    el.closest('#mobileNav');

  let pending = [];
  document.querySelectorAll('main section, main .page-head').forEach(section => {
    if (skip(section)) return;
    const kids = Array.from(section.children).filter(el => {
      if (skip(el)) return false;
      const pos = getComputedStyle(el).position;
      // Decorative absolutely-positioned art shouldn't shift.
      return pos !== 'absolute' && pos !== 'fixed';
    });
    (kids.length ? kids : [section]).forEach(el => pending.push(el));
  });

  if (!pending.length) return;

  pending.forEach(el => el.classList.add('reveal'));
  // Only switch the CSS on once we know we can drive it, so content is never
  // hidden by a stylesheet we aren't able to animate.
  document.documentElement.classList.add('reveal-ready');

  const show = el => {
    const siblings = el.parentElement ? Array.from(el.parentElement.children) : [];
    const idx = Math.max(0, siblings.indexOf(el));
    // Small stagger between siblings entering together.
    el.style.setProperty('--reveal-delay', Math.min(idx, 4) * 0.07 + 's');
    el.classList.add('is-in');
  };

  // Reveal anything within (or just short of) the viewport, then drop it.
  const sweep = () => {
    if (!pending.length) return;
    const limit = window.innerHeight + 80;
    pending = pending.filter(el => {
      const r = el.getBoundingClientRect();
      const visible = r.top < limit && r.bottom > -80;
      if (visible) show(el);
      return !visible;
    });
    if (!pending.length) teardown();
  };

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; sweep(); });
  };

  let safety;
  function teardown(){
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    clearInterval(safety);
  }

  window.addEventListener('scroll', onScroll, { passive:true });
  window.addEventListener('resize', onScroll, { passive:true });

  // Backstop: catches layout settling after fonts/images and any environment
  // where scroll events are unreliable. Only ever reveals what's on screen, so
  // the effect is preserved for content further down the page.
  safety = setInterval(sweep, 900);

  requestAnimationFrame(sweep);
  window.addEventListener('load', sweep, { once:true });
})();
