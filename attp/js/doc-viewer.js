// Document viewer: ATTP's documents are shown inside the site as page images, never as
// PDF files, so there is no file to download and no text to select or copy. The pages
// live in documents/view/<slug>/<n>.webp (rendered from the signed originals, which stay
// off the site). Right-click, dragging, long-press saving, copy, save and print shortcuts
// are blocked while it is open, and printing gives a blank page. A screenshot still
// works; nothing in a browser can stop that.
(function(){
  let dlg, pagesEl, opener = null;

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
  window.openDocument = function(d, from){
    if (!dlg) build();
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
