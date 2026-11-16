// Document viewer: ATTP's documents are shown inside the site as page images, never as
// PDF files, so there is no file to download and no text to select or copy. The pages
// live in documents/view/<slug>/<n>.webp (rendered from the signed originals, which stay
// off the site). Right-click, dragging, long-press saving, copy, save and print shortcuts
// are blocked while it is open, and printing gives a blank page. A screenshot still
// works; nothing in a browser can stop that.
(function(){
  let dlg, pagesEl, opener = null;

  // Translated versions: documents/view/<slug>-<lang>/<n>.webp, typeset from the reviewed
  // translation (_traducere/documente, not on the site). Written by its publish.py.
  /* TRANSLATIONS */const TR = {"antimanipulare-2026":{"ru":{"pages":9,"w":1240,"h":1755}},"avertizare-interna-2026":{"ru":{"pages":11,"w":1240,"h":1755}},"codul-etica-2026":{"ru":{"pages":15,"w":1240,"h":1755}},"conflict-interese-2026":{"ru":{"pages":9,"w":1240,"h":1755}},"integritate-sportiva-2026":{"ru":{"pages":11,"w":1240,"h":1755}},"regulament-arbitri-tt-2026":{"ru":{"pages":25,"w":1240,"h":1755}},"regulament-baschet-3x3-2026":{"ru":{"pages":39,"w":1240,"h":1755}},"regulament-baschet-5x5-2026":{"ru":{"pages":48,"w":1240,"h":1755}},"statut-2026":{"ru":{"pages":16,"w":1240,"h":1605}},"titluri-categorii-tt-2026":{"ru":{"pages":8,"w":1754,"h":1240}}};/* /TRANSLATIONS */
  const LANG = window.ATTP_LANG || 'ro';
  // The version of a document the reader gets on this page: the translation if there is
  // one for this language, else the Romanian original. lang = the language of the pages.
  window.docVersion = function(d){
    const v = TR[d.slug] && TR[d.slug][LANG];
    return v ? { slug:`${d.slug}-${LANG}`, pages:v.pages, w:v.w, h:v.h, lang:LANG }
             : { slug:d.slug, pages:d.pages, w:d.w || 1240, h:d.h || 1753, lang:'ro' };
  };

  function build(){
    dlg = document.createElement('dialog');
    dlg.className = 'doc-viewer';
    dlg.setAttribute('aria-labelledby', 'dvTitle');
    dlg.innerHTML = `
      <div class="dv-bar">
        <span class="dv-head"><strong class="dv-title" id="dvTitle"></strong><span class="dv-count"></span></span>
        <button type="button" class="dv-close" aria-label="${t('Închide documentul')}">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>
        </button>
      </div>
      <div class="dv-pages" tabindex="0"></div>`;
    document.body.append(dlg);
    pagesEl = dlg.querySelector('.dv-pages');
    dlg.querySelector('.dv-close').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => {
      document.documentElement.classList.remove('dv-open');
      pagesEl.scrollTop = 0;
      pagesEl.innerHTML = '';
      if (opener) opener.focus();
    });
    ['contextmenu', 'dragstart', 'copy', 'cut', 'selectstart'].forEach(type =>
      dlg.addEventListener(type, e => e.preventDefault()));
  }

  // Save, print and copy shortcuts do nothing while a document is open.
  document.addEventListener('keydown', e => {
    if (!dlg || !dlg.open) return;
    if ((e.ctrlKey || e.metaKey) && /^[spca]$/i.test(e.key)) e.preventDefault();
  });

  // d = { title, slug, pages, w, h }
  window.openDocument = function(doc, from){
    if (!dlg) build();
    const d = Object.assign({}, doc, docVersion(doc));
    opener = from || null;
    dlg.querySelector('.dv-title').textContent = t(d.title);
    dlg.querySelector('.dv-count').textContent = `${d.pages} ${tp(d.pages, 'pagină', 'pagini')}`;
    let html = '';
    for (let i = 1; i <= d.pages; i++) {
      html += `<div class="dv-page" style="aspect-ratio:${d.w}/${d.h}">` +
        `<img src="documents/view/${d.slug}/${i}.webp" width="${d.w}" height="${d.h}" alt="${t('Pagina')} ${i} / ${d.pages}" ` +
        `draggable="false" decoding="async"${i > 2 ? ' loading="lazy"' : ''}></div>`;
    }
    pagesEl.innerHTML = html;
    document.documentElement.classList.add('dv-open');
    dlg.showModal();
    // Every document starts on its first page. This has to happen once the dialog is
    // shown: a hidden element ignores scrollTop and keeps the last document's position.
    pagesEl.scrollTop = 0;
    pagesEl.focus({ preventScroll:true });
    requestAnimationFrame(() => { pagesEl.scrollTop = 0; });
  };
})();
