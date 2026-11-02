// The hall floor's moving parts: the painted court lines (drawn in on the first page of a
// visit, then drifting a little slower than the page) and a ping-pong ball that bounces
// across the floor in step with the scroll, left to right over the page, six bounces.
// Without JavaScript the same lines come from css (body::before); with reduced motion
// the lines stay still and the ball is hidden.
(function(){
  const NS = 'http://www.w3.org/2000/svg';
  const layer = document.createElement('div');
  layer.className = 'floor-live';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = `<svg xmlns="${NS}" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" fill="none">
    <g stroke="#FFFFFF" stroke-opacity=".6" stroke-width="4">
      <path pathLength="1" d="M-20 92H1620"/><path pathLength="1" d="M1180 92V1100"/>
      <circle pathLength="1" cx="1180" cy="560" r="150"/>
      <path pathLength="1" d="M-20 420H250V700H-20"/>
      <path pathLength="1" d="M-20 140H40A520 420 0 0 1 40 980H-20"/>
    </g>
    <g stroke="#E8B21F" stroke-opacity=".42" stroke-width="4">
      <path pathLength="1" d="M520 -20V1020"/><path pathLength="1" d="M820 -20V1020"/><path pathLength="1" d="M300 236H1040"/>
    </g></svg><span class="floor-ball"></span><span class="floor-ball-shadow"></span>`;
  let first = true;
  try { first = !sessionStorage.getItem('attp-floor'); sessionStorage.setItem('attp-floor', '1'); } catch (e) {}
  if (first) layer.classList.add('is-drawing');
  document.body.prepend(layer);
  document.documentElement.classList.add('floor-live-on');

  if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const svg = layer.querySelector('svg');
  const ball = layer.querySelector('.floor-ball'), shadow = layer.querySelector('.floor-ball-shadow');
  let queued = false;
  const paint = () => {
    queued = false;
    const y = scrollY, max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const p = Math.min(1, y / max);
    svg.style.transform = `translate3d(0,${(-y * 0.06).toFixed(1)}px,0)`;
    const floorY = innerHeight * 0.84, x = 24 + p * (innerWidth - 70);
    const hop = Math.abs(Math.sin(p * Math.PI * 6)) * Math.min(160, innerHeight * 0.2);
    ball.style.transform = `translate3d(${x.toFixed(1)}px,${(floorY - hop).toFixed(1)}px,0)`;
    shadow.style.transform = `translate3d(${x.toFixed(1)}px,${(floorY + 18).toFixed(1)}px,0) scale(${(1 - hop / 400).toFixed(3)})`;
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  addEventListener('scroll', queue, { passive:true });
  addEventListener('resize', queue);
  paint();
})();
