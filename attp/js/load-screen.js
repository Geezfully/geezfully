// ATTP — shared brief load-screen, gated before paint by load-screen-gate.js.
(function(){
  const navigationKey = 'attp-internal-navigation';

  // Mark same-site HTML link clicks so the destination can use the 10% rule.
  document.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    const link = target && target.closest('a[href]');
    if (!link || event.defaultPrevented || link.target === '_blank' || link.hasAttribute('download')) return;

    let destination;
    try { destination = new URL(link.href, location.href); } catch (_) { return; }
    const sitePath = location.pathname.slice(0, location.pathname.lastIndexOf('/') + 1);
    if (destination.origin !== location.origin || destination.protocol === 'file:' && location.protocol !== 'file:') return;
    if (!destination.pathname.startsWith(sitePath)) return;
    if (destination.pathname === location.pathname && destination.search === location.search) return;
    if (!destination.pathname.endsWith('.html') && !destination.pathname.endsWith('/')) return;

    try { sessionStorage.setItem(navigationKey, '1'); } catch (_) {}
  }, true);

  const screen = document.getElementById('loadScreen');
  if (!screen) return;
  if (!window.__attpShowLoadScreen) {
    screen.remove();
    return;
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.add('lb-lock');

  let hidden = false;
  const hide = () => {
    if (hidden) return;
    hidden = true;
    screen.classList.add('is-hidden');
    document.documentElement.classList.remove('show-load-screen');
    document.documentElement.classList.remove('lb-lock');
    setTimeout(() => screen.remove(), 480);
  };

  // Background tabs get their timers throttled by the browser, so a plain
  // setTimeout can sit frozen for minutes if this tab isn't the active one.
  // Only count down while visible, and resolve instantly on return if the
  // tab was backgrounded mid-animation — the intro moment has already
  // passed, so there's no point making the user wait for it to resume.
  let timer = null;
  const start = () => { timer = setTimeout(hide, reduced ? 400 : 1650); };
  const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };

  if (document.visibilityState === 'visible') start();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!timer) hide();
    } else {
      stop();
    }
  });
})();
