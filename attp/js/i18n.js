// ATTP — language runtime. Romanian pages run with an empty dictionary; the generated
// /en/ and /ru/ pages set window.__PAGE_LANG__ and load js/i18n-<lang>.js first.
(function(){
  const LANG = window.__PAGE_LANG__ || 'ro';
  const DICT = window.ATTP_T || {};
  window.ATTP_LANG = LANG;
  // Translate a Romanian UI string; falls back to the Romanian text when a key is missing.
  window.t = s => (LANG === 'ro' ? s : (DICT[s] ?? s));
  // Link to another page in the current language (generated pages resolve against <base href="../">).
  // Plural from two Romanian forms, e.g. tp(n, 'album', 'albume'). Russian dictionary
  // entries for the plural form hold "few|many" (альбома|альбомов).
  window.tp = (n, one, other) => {
    if (LANG === 'ro') return n === 1 ? one : other;
    if (LANG === 'ru') {
      const cat = new Intl.PluralRules('ru').select(n);
      if (cat === 'one') return t(one);
      const [few, many] = t(other).split('|');
      return cat === 'few' ? few : (many || few);
    }
    return n === 1 ? t(one) : t(other);
  };
  window.pageHref = p => (LANG === 'ro' ? p : `${LANG}/${p}`);
  // Keep ?id= / ?slug= and #anchors when switching language.
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.lang-switch a[hreflang]').forEach(a => {
      a.setAttribute('href', a.getAttribute('href').split(/[?#]/)[0] + location.search + location.hash);
    });
  });
})();
