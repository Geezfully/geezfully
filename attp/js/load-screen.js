// ATTP — shared brief load-screen shown on every page while it settles in.
(function(){
  const screen = document.getElementById('loadScreen');
  if (!screen) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.add('lb-lock');

  let hidden = false;
  const hide = () => {
    if (hidden) return;
    hidden = true;
    screen.classList.add('is-hidden');
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
