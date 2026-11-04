// The flip counter — the white flip cards that stand beside every table and count
// the points. flipNumber() renders a number as cards and, the first time it is seen,
// turns each card up from 0 the way a referee does, a fraction behind its neighbour.
// flipScore() renders a small two-card score (left card blue, right card red, as on
// a real counter). Reduced motion: the final number is set at once.
(function(){
  const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = n => n.toLocaleString((window.DATE_LOCALE && DATE_LOCALE[window.ATTP_LANG]) || 'ro-RO');

  function render(el, digits, startAtZero){
    el.classList.add('flip');
    el.innerHTML = digits.map((d, i) => {
      const fromEnd = digits.length - i;
      const gap = i > 0 && fromEnd % 3 === 0 ? '<i class="flip-gap" aria-hidden="true"></i>' : '';
      return `${gap}<b class="flip-card" aria-hidden="true"><span>${startAtZero ? 0 : d}</span></b>`;
    }).join('');
  }

  function turn(el, digits){
    const spans = [...el.querySelectorAll('.flip-card span')];
    spans.forEach((span, i) => {
      const target = +digits[i];
      let cur = 0;
      const card = span.parentElement;
      const step = () => {
        if (cur === target) return;
        cur += 1;
        card.classList.remove('is-turning');
        void card.offsetWidth;                       // restart the turn
        card.classList.add('is-turning');
        setTimeout(() => { span.textContent = cur; }, 45);
        setTimeout(step, 100);
      };
      setTimeout(step, 250 + i * 110);
    });
  }

  window.flipNumber = function(el, n){
    if (!el) return;
    if (!Number.isFinite(n)) { el.textContent = '—'; return; }
    const digits = String(Math.max(0, Math.round(n))).split('');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', fmt(n));
    const animate = !reduce() && 'IntersectionObserver' in window;
    render(el, digits, animate);
    if (!animate) return;
    const io = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      turn(el, digits);
    }, { threshold: .4 });
    io.observe(el);
  };

  window.flipScore = function(a, b){
    const v = x => (x === null || x === undefined || x === '') ? '–' : String(x);
    return `<span class="flip flip--mini" role="img" aria-label="${v(a)}:${v(b)}">` +
      `<b class="flip-card" aria-hidden="true"><span>${v(a)}</span></b>` +
      `<i class="flip-sep" aria-hidden="true">:</i>` +
      `<b class="flip-card" aria-hidden="true"><span>${v(b)}</span></b></span>`;
  };
})();
