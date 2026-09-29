// Decide before the page paints whether this navigation gets the ATTP loader.
(function(){
  const navigationKey = 'attp-internal-navigation';
  let internalNavigation = false;

  try {
    internalNavigation = sessionStorage.getItem(navigationKey) === '1';
    sessionStorage.removeItem(navigationKey);
  } catch (_) {
    // Storage can be unavailable in privacy-restricted browsing contexts.
  }

  // Always show on a fresh/direct site entry. Once inside the site, keep the
  // animation as a roughly one-in-ten surprise between HTML pages.
  const shouldShow = !internalNavigation || Math.random() < 0.1;
  window.__attpShowLoadScreen = shouldShow;
  if (shouldShow) {
    // A separate, fair draw: the 10% appearance gate must not bias the sport.
    // Set before paint so only the selected animation is requested by CSS.
    document.documentElement.dataset.loadSport = Math.random() < 0.5 ? 'pingpong' : 'basketball';
    document.documentElement.classList.add('show-load-screen');
  }
})();
