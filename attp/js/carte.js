/* ===================================================================
   ATTP book reader — "Dincolo de victorie"
   The printed pages are images (carti/<slug>/pagini/NNN.webp, rendered
   from the author's PDF, which itself stays off the site), bound into a
   flip book with StPageFlip (js/vendor/page-flip, MIT). Adapted from the
   ADP journal reader: drag / click / swipe / keys to turn, contents
   drawer, scrubber, zoom, shareable #pN links, resume where you stopped,
   and a scrolling view with the same pages one under another.
   =================================================================== */
(function () {
  "use strict";

  var PW = 600, PH = 847;                       // the book's page proportions (481.9 × 680.4 pt)
  var BOOK = window.ATTP_BOOK;
  var STORE = "attp-carte-" + BOOK.slug;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function src(n) { return BOOK.dir + "pagini/" + String(n).padStart(3, "0") + ".webp?v=" + BOOK.v; }

  /* ---------------------------------------------------------------
     Pages: the printed ones (1 … BOOK.pages), then a plain back board
     so the book closes (an even count keeps both covers single).
     --------------------------------------------------------------- */
  var pages = [];
  for (var n = 1; n <= BOOK.pages; n++) pages.push({ kind: n === 1 ? "cover" : "paper", n: n });
  if (pages.length % 2 === 1) pages.push({ kind: "back" });
  function total() { return pages.length; }
  function side(i) { return i % 2 === 1 ? "l" : "r"; }
  function pageHtml(i) {
    var p = pages[i];
    if (p.kind === "back") {
      return '<div class="pg back"><span class="bk-title">' + esc(BOOK.title) + '</span><span class="bk-sub">' + esc(BOOK.author) +
        '</span><span class="bk-sub">ATTP · ' + esc(BOOK.year) + '</span><span class="bk-isbn">ISBN ' + esc(BOOK.isbn) + "</span></div>";
    }
    var alt = p.kind === "cover" ? t(BOOK.coverAlt) : t("Pagina {n}").replace("{n}", p.n);
    return '<div class="pg is-wait ' + (p.kind === "cover" ? "cover" : side(i)) + '"><img data-src="' + src(p.n) + '" alt="' + esc(alt) +
      '" width="1400" height="1977" draggable="false"></div>';
  }

  // the section a page belongs to (last contents entry starting at or before it)
  function sectionOf(i) {
    var pg = i + 1, best = null;
    BOOK.toc.forEach(function (e) { if (e[2] <= pg) best = e; });
    return best;
  }

  /* ---------------------------------------------------------------
     The book
     --------------------------------------------------------------- */
  var stage = $("#stage"), scroller = $("#scroller"), wrap = $("#zoomWrap");
  var book = null, host = null, box = null, els = [], portrait = false, current = 0;
  var loaded = {};                               // page index -> image requested once (the browser keeps it)

  var ZB = [1, 1.5, 2, 2.5], ZT = [1, 1.25, 1.5, 1.75, 2];
  var zb = 0, zt = 0;
  try {
    var zs = JSON.parse(localStorage.getItem("attp-carte-zoom") || "{}");
    zb = Math.max(0, Math.min(ZB.length - 1, zs.b | 0));
    zt = Math.max(0, Math.min(ZT.length - 1, zs.t | 0));
  } catch (e) {}
  function Z() { return ZB[zb]; }
  var touchMode = matchMedia("(hover: none) and (pointer: coarse)").matches;

  // load the pages around the open spread, nearest first
  function ensure(i) {
    var want = [];
    for (var d = 0; d <= 6; d++) { want.push(i + d); if (d) want.push(i - d); }
    want.forEach(function (k) {
      if (k < 0 || k >= total() || !els[k]) return;
      var img = els[k].querySelector("img[data-src]");
      if (!img || img.getAttribute("src")) return;
      img.onload = img.onerror = function () { var pg = img.parentNode; if (pg) pg.classList.remove("is-wait"); };
      img.src = img.dataset.src;
      loaded[k] = true;
    });
  }

  function layout() {
    var W = stage.clientWidth, H = stage.clientHeight;
    var pad = W > 760 ? 96 : 10, vpad = W > 760 ? 26 : 12;
    var aw = W - pad * 2, ah = H - vpad * 2, k = PH / PW;
    portrait = aw / ah < 1.02;
    var pageH = portrait ? Math.min(ah, aw * k) : Math.min(ah, (aw / 2) * k);
    var pageW = Math.floor(pageH / k);
    return { width: portrait ? pageW : pageW * 2, portrait: portrait, pad: pad, vpad: vpad };
  }
  function setScale() {
    if (!book) return;
    var r = book.getBoundsRect();
    if (r && r.pageWidth) host.style.setProperty("--s", (r.pageWidth / PW).toFixed(5));
  }
  function buildBook(startPage, focus) {
    if (book) { try { book.destroy(); } catch (e) {} book = null; }
    if (box) box.remove();
    var L = layout(), z = Z();
    document.body.classList.toggle("is-zoomed", z > 1);
    wrap.style.padding = L.vpad + "px " + L.pad + "px";
    box = document.createElement("div");
    box.className = "book-box";
    box.style.width = Math.round(L.width * z) + "px";
    host = document.createElement("div");
    host.className = "book-host";
    box.appendChild(host);
    wrap.appendChild(box);
    els = pages.map(function (pg, i) {
      var d = document.createElement("div");
      d.className = "page";
      if (pg.kind === "cover" || pg.kind === "back") d.dataset.density = "hard";
      d.innerHTML = pageHtml(i);
      return d;
    });
    els.forEach(function (d) { host.appendChild(d); });
    // pages seen before: give them their image straight away (it is cached)
    Object.keys(loaded).forEach(function (k) { var img = els[k] && els[k].querySelector("img"); if (img) { img.src = img.dataset.src; img.parentNode.classList.remove("is-wait"); } });
    book = new St.PageFlip(host, {
      width: PW, height: PH, size: "stretch",
      minWidth: L.portrait ? Math.ceil(L.width * 0.75) : 40, maxWidth: 4000, minHeight: 60, maxHeight: 6000,
      showCover: true, usePortrait: true, autoSize: true,
      maxShadowOpacity: 0.42, flippingTime: 820, mobileScrollSupport: false,
      swipeDistance: 24, startPage: startPage || 0, startZIndex: 1,
      useMouseEvents: z === 1 && !touchMode
    });
    book.on("flip", function (e) {
      current = e.data; onPage();
      if (Z() > 1) scroller.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    });
    book.on("changeState", function (e) {
      if (e.data === "flipping" && (current <= 0 || current >= total() - 1)) box.style.transform = "none";
      // a drag is about to show the next spread: make sure its pages are there
      if (e.data === "user_fold" || e.data === "fold_corner" || e.data === "flipping") ensure(current);
    });
    book.on("init", function () { setScale(); onPage(); });
    book.on("changeOrientation", setScale);
    book.loadFromHTML(els);
    setScale();
    current = book.getCurrentPageIndex();
    onPage();
    if (z === 1) { scroller.scrollLeft = 0; scroller.scrollTop = 0; }
    else if (focus) {
      requestAnimationFrame(function () {
        scroller.scrollLeft = focus.fx * scroller.scrollWidth - focus.px;
        scroller.scrollTop = focus.fy * scroller.scrollHeight - focus.py;
      });
    }
  }
  var resizeT;
  window.addEventListener("resize", function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      if (!book || document.body.classList.contains("reading")) return;
      var L = layout();
      if (L.portrait !== portrait || Math.abs(L.width * Z() - box.offsetWidth) > 2) buildBook(current, captureFocus());
      else setScale();
    }, 140);
  });

  function go(n) {
    n = Math.max(0, Math.min(total() - 1, n));
    if (!book) return;
    ensure(n);
    if (Math.abs(n - current) <= 2) book.flip(n);
    else { book.turnToPage(n); current = n; box.classList.remove("is-fading"); void box.offsetWidth; box.classList.add("is-fading"); onPage(); }
  }
  function next() { if (book) { ensure(current + 2); book.flipNext(); } }
  function prev() { if (book) { ensure(current - 2); book.flipPrev(); } }

  /* ---------------------------------------------------------------
     Toolbar state
     --------------------------------------------------------------- */
  var where = $("#where"), range = $("#range"), tip = $("#scrubTip");
  function isBack(i) { return pages[i] && pages[i].kind === "back"; }
  function label(i) {
    var T = BOOK.pages;
    if (i <= 0) return "<b>" + t("Coperta") + "</b>";
    if (isBack(i)) return "<b>" + t("Coperta a IV-a") + "</b>";
    if (portrait || !book || book.getOrientation() === "portrait") return t("Pagina") + " <b>" + (i + 1) + "</b> " + t("din") + " " + T;
    var a = i % 2 === 1 ? i : i - 1;
    var b = Math.min(a + 2, T);
    return t("Paginile") + " <b>" + (a + 1) + (b > a + 1 ? "–" + b : "") + "</b> " + t("din") + " " + T;
  }
  function centre(i) {
    if (!box) return;
    var land = book && book.getOrientation() === "landscape";
    box.style.transform = !land ? "none" : i <= 0 ? "translateX(-25%)" : i >= total() - 1 ? "translateX(25%)" : "none";
  }
  function onPage() {
    ensure(current);
    centre(current);
    where.innerHTML = label(current);
    range.max = total();
    range.value = current + 1;
    $("#navPrev").disabled = current <= 0;
    $("#navNext").disabled = current >= total() - 1;
    try {
      history.replaceState(null, "", current > 0 ? "#p" + (current + 1) : location.pathname + location.search);
      if (current > 4) localStorage.setItem(STORE, String(current));
    } catch (e) {}
    if (current > 0) dismissHint();
  }
  function ticks() {
    var tk = $("#ticks"); tk.innerHTML = "";
    BOOK.toc.forEach(function (e) {
      if (e[0] !== 0) return;
      var i = document.createElement("i");
      i.style.left = ((e[2] - 1) / Math.max(1, total() - 1) * 100) + "%";
      tk.appendChild(i);
    });
  }
  range.addEventListener("input", function () {
    var v = +range.value, pct = (v - 1) / Math.max(1, total() - 1);
    var sec = sectionOf(v - 1);
    tip.innerHTML = (v === 1 ? t("Coperta") : isBack(v - 1) ? t("Coperta a IV-a") : t("Pagina") + " " + v) +
      (sec && v > 1 && !isBack(v - 1) ? "<small>" + esc(sec[1]) + "</small>" : "");
    tip.style.left = "calc(" + (pct * 100) + "% + " + (9 - pct * 18) + "px)";
    tip.classList.add("is-on");
  });
  range.addEventListener("change", function () { tip.classList.remove("is-on"); go(+range.value - 1); });
  range.addEventListener("blur", function () { tip.classList.remove("is-on"); });

  $("#navPrev").addEventListener("click", prev);
  $("#navNext").addEventListener("click", next);
  $("#btnPrev").addEventListener("click", prev);
  $("#btnNext").addEventListener("click", next);

  document.addEventListener("keydown", function (e) {
    // no saving, printing or copying the pages
    if ((e.ctrlKey || e.metaKey) && /^[spc]$/i.test(e.key)) { e.preventDefault(); return; }
    if (e.target.matches("input, textarea")) return;
    if (e.key === "Escape") { closeDrawer(); return; }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoom(1); return; }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); setZoom(-1); return; }
      if (e.key === "0") { e.preventDefault(); setZoom("reset"); return; }
    }
    if (document.body.classList.contains("reading") || $("#drawer").classList.contains("is-open")) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); prev(); }
    else if (e.key === "Home") { e.preventDefault(); go(0); }
    else if (e.key === "End") { e.preventDefault(); go(total() - 1); }
  });
  ["contextmenu", "dragstart", "copy", "cut", "selectstart"].forEach(function (type) {
    document.addEventListener(type, function (e) { if (!e.target.closest || !e.target.closest("input")) e.preventDefault(); });
  });

  // no corner peel on hover: a page lifts only when pressed or dragged
  window.addEventListener("mousemove", function (e) {
    if (e.buttons === 0 && book) e.stopImmediatePropagation();
  }, true);

  // touch: a quick tap on the outer thirds of the book turns the page
  var tap = null;
  stage.addEventListener("touchstart", function (e) {
    var t0 = e.changedTouches[0];
    tap = { x: t0.clientX, y: t0.clientY, t: Date.now() };
  }, { passive: true });
  stage.addEventListener("touchend", function (e) {
    if (!tap || !box || Z() > 1) return;
    var t1 = e.changedTouches[0];
    var moved = Math.abs(t1.clientX - tap.x) + Math.abs(t1.clientY - tap.y);
    var quick = Date.now() - tap.t < 350;
    tap = null;
    if (moved > 12 || !quick || e.target.closest("a,button")) return;
    var r = box.getBoundingClientRect();
    if (t1.clientY < r.top || t1.clientY > r.bottom) return;
    var rel = (t1.clientX - r.left) / r.width;
    if (rel > 0.66) next(); else if (rel < 0.34) prev();
  }, { passive: true });

  /* Touch: drag the page with a finger. The engine's own drag would need the
     finger to travel past the screen edge on a phone, so it gets an
     amplified position: about half a screen turns the page, a flick too. */
  var drag = null, pinch = null;
  function blockRect() { var b = host && host.querySelector(".stf__block"); return b ? b.getBoundingClientRect() : null; }
  function cancelDrag() {
    if (drag && drag.started && book) book.userStop({ x: drag.sx, y: drag.sy });
    drag = null;
  }
  stage.addEventListener("touchstart", function (e) {
    if (!touchMode || Z() > 1 || !book || e.touches.length !== 1 || pinch) return;
    if (e.target.closest("a,button") || !box.contains(e.target)) return;
    var t0 = e.touches[0], br = blockRect();
    if (!br) return;
    drag = { x0: t0.clientX, y0: t0.clientY, t0: Date.now(), br: br, started: false };
  }, { passive: true });
  stage.addEventListener("touchmove", function (e) {
    if (!drag) return;
    if (e.touches.length !== 1) { cancelDrag(); return; }
    var t1 = e.touches[0], dx = t1.clientX - drag.x0, dy = t1.clientY - drag.y0;
    if (!drag.started) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) { if (Math.abs(dy) > 16) drag = null; return; }
      var fwd = dx < 0;
      if ((fwd && current >= total() - 1) || (!fwd && current <= 0)) { drag = null; return; }
      ensure(current + (fwd ? 2 : -2));
      var R = book.getBoundsRect(), spine = R.left + R.width / 2;
      var land = book.getOrientation() === "landscape";
      drag.k = land ? 1.6 : 2.1;
      drag.spine = spine; drag.fwd = fwd;
      drag.sx = fwd ? spine + R.pageWidth - 2 : spine - R.pageWidth + 2;
      drag.sy = Math.min(R.top + R.height - 2, Math.max(R.top + 2, drag.y0 - drag.br.top));
      drag.started = true;
      book.startUserTouch({ x: drag.sx, y: drag.sy });
    }
    e.preventDefault();
    drag.last = { x: drag.sx + dx * drag.k, y: drag.sy + dy * 0.6 };
    book.userMove(drag.last, true);
  }, { passive: false });
  stage.addEventListener("touchend", function (e) {
    if (!drag) return;
    var d = drag; drag = null;
    if (!d.started) return;
    var dx = e.changedTouches[0].clientX - d.x0, quick = Date.now() - d.t0 < 320;
    var pos = d.last || { x: d.sx, y: d.sy };
    if (quick && Math.abs(dx) > 30) {
      pos = { x: d.fwd ? d.spine - 12 : d.spine + 12, y: pos.y };
      book.userMove(pos, true);
    }
    book.userStop(pos);
  });
  stage.addEventListener("touchcancel", cancelDrag);

  /* ---------------------------------------------------------------
     Zoom: the flip book is rebuilt larger (pan by dragging); in the
     scrolling view the pages simply get wider
     --------------------------------------------------------------- */
  var tv = $("#tv"), tvInner = $("#tvInner");
  function captureFocus(cx, cy) {
    var r = scroller.getBoundingClientRect();
    var px = cx == null ? scroller.clientWidth / 2 : cx - r.left;
    var py = cy == null ? scroller.clientHeight / 2 : cy - r.top;
    return { px: px, py: py, fx: (scroller.scrollLeft + px) / Math.max(1, scroller.scrollWidth), fy: (scroller.scrollTop + py) / Math.max(1, scroller.scrollHeight) };
  }
  function tvPage() {              // index of the first page visible in the scrolling view
    var list = tvInner.children;
    for (var i = 0; i < list.length; i++) if (list[i].getBoundingClientRect().bottom > 90) return i;
    return 0;
  }
  function applyTextZoom(keep) {
    var i = keep ? tvPage() : -1, off = 0;
    if (i >= 0) off = tvInner.children[i].getBoundingClientRect().top;
    tv.style.setProperty("--tz", ZT[zt]);
    if (i >= 0) tv.scrollTop += tvInner.children[i].getBoundingClientRect().top - off;
  }
  function saveZoom() { try { localStorage.setItem("attp-carte-zoom", JSON.stringify({ b: zb, t: zt })); } catch (e) {} }
  function updateZoomUI() {
    var reading = document.body.classList.contains("reading");
    var i = reading ? zt : zb, L = reading ? ZT : ZB;
    $("#zoomReset").textContent = Math.round(L[i] * 100) + "%";
    $("#zoomOut").disabled = i <= 0;
    $("#zoomIn").disabled = i >= L.length - 1;
  }
  var flashT;
  function flash() {
    var f = $("#zflash");
    f.textContent = $("#zoomReset").textContent;
    f.classList.add("is-on");
    clearTimeout(flashT);
    flashT = setTimeout(function () { f.classList.remove("is-on"); }, 700);
  }
  function setZoom(steps, cx, cy) {
    if (document.body.classList.contains("reading")) {
      var nt = steps === "reset" ? 0 : Math.max(0, Math.min(ZT.length - 1, zt + steps));
      if (nt !== zt) { zt = nt; applyTextZoom(true); }
    } else {
      var nb = steps === "reset" ? 0 : Math.max(0, Math.min(ZB.length - 1, zb + steps));
      if (nb !== zb && book) { var f = captureFocus(cx, cy); zb = nb; buildBook(current, f); }
    }
    saveZoom(); updateZoomUI(); flash();
  }
  $("#zoomIn").addEventListener("click", function () { setZoom(1); });
  $("#zoomOut").addEventListener("click", function () { setZoom(-1); });
  $("#zoomReset").addEventListener("click", function () { setZoom("reset"); });

  var wheelAcc = 0, wheelT = 0;
  function onWheel(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    wheelAcc -= e.deltaY;
    var now = Date.now();
    if (now - wheelT < 170) return;
    if (wheelAcc > 24) { wheelT = now; wheelAcc = 0; setZoom(1, e.clientX, e.clientY); }
    else if (wheelAcc < -24) { wheelT = now; wheelAcc = 0; setZoom(-1, e.clientX, e.clientY); }
  }
  stage.addEventListener("wheel", onWheel, { passive: false });
  tv.addEventListener("wheel", onWheel, { passive: false });

  var pan = null;
  scroller.addEventListener("mousedown", function (e) {
    if (Z() === 1 || e.button !== 0 || e.target.closest("a,button")) return;
    pan = { x: e.clientX, y: e.clientY, l: scroller.scrollLeft, t: scroller.scrollTop };
    scroller.classList.add("is-panning");
    e.preventDefault();
  });
  window.addEventListener("mousemove", function (e) {
    if (!pan) return;
    scroller.scrollLeft = pan.l - (e.clientX - pan.x);
    scroller.scrollTop = pan.t - (e.clientY - pan.y);
  });
  window.addEventListener("mouseup", function () { if (pan) { pan = null; scroller.classList.remove("is-panning"); } });

  // two-finger pinch (book and scrolling view)
  function fingers(e) { var a = e.touches[0], b = e.touches[1]; return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }
  document.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 2) return;
    var reading = document.body.classList.contains("reading");
    if (!(reading ? tv : stage).contains(e.target)) return;
    cancelDrag();
    var f = fingers(e);
    pinch = { d0: f.d, x: f.x, y: f.y, r: 1, reading: reading };
    var el = reading ? tvInner : wrap, r = el.getBoundingClientRect();
    el.style.transformOrigin = (f.x - r.left) + "px " + (f.y - r.top) + "px";
    e.preventDefault();
  }, { passive: false, capture: true });
  document.addEventListener("touchmove", function (e) {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    pinch.r = fingers(e).d / pinch.d0;
    (pinch.reading ? tvInner : wrap).style.transform = "scale(" + Math.max(0.5, Math.min(3, pinch.r)) + ")";
  }, { passive: false, capture: true });
  document.addEventListener("touchend", function (e) {
    if (!pinch || e.touches.length >= 2) return;
    var p = pinch; pinch = null;
    var el = p.reading ? tvInner : wrap;
    el.style.transform = ""; el.style.transformOrigin = "";
    if (p.reading) {
      var want = ZT[zt] * p.r, best = 0;
      ZT.forEach(function (v, i) { if (Math.abs(v - want) < Math.abs(ZT[best] - want)) best = i; });
      if (best !== zt) { zt = best; applyTextZoom(true); saveZoom(); updateZoomUI(); flash(); }
    } else {
      var steps = Math.round(Math.log(p.r) / Math.log(1.45));
      if (steps) setZoom(steps, p.x, p.y);
    }
  }, { capture: true });

  /* hint */
  var hint = $("#hint");
  function dismissHint() {
    if (hint.classList.contains("is-gone")) return;
    hint.classList.add("is-gone");
    try { localStorage.setItem(STORE + "-hint", "1"); } catch (e) {}
  }

  /* fullscreen */
  $("#btnFull").addEventListener("click", function () {
    var d = document;
    if (!d.fullscreenElement) { (d.documentElement.requestFullscreen || function () {}).call(d.documentElement); }
    else d.exitFullscreen();
  });
  if (!document.documentElement.requestFullscreen) $("#btnFull").hidden = true;

  /* ---------------------------------------------------------------
     Contents drawer: the book's own contents, with the real pages
     --------------------------------------------------------------- */
  var drawer = $("#drawer"), scrim = $("#scrim");
  function openDrawer() {
    buildDrawer();
    drawer.classList.add("is-open"); scrim.classList.add("is-on");
    $("#btnToc").setAttribute("aria-expanded", "true");
    var here = drawer.querySelector(".is-here");
    if (here) here.scrollIntoView({ block: "center" });
    setTimeout(function () { (here || drawer.querySelector("button")).focus({ preventScroll: true }); }, 60);
  }
  function closeDrawer() {
    if (!drawer.classList.contains("is-open")) return;
    drawer.classList.remove("is-open"); scrim.classList.remove("is-on");
    $("#btnToc").setAttribute("aria-expanded", "false");
    $("#btnToc").focus({ preventScroll: true });
  }
  $("#btnToc").addEventListener("click", function () { drawer.classList.contains("is-open") ? closeDrawer() : openDrawer(); });
  scrim.addEventListener("click", closeDrawer);
  $("#drawerClose").addEventListener("click", closeDrawer);
  function buildDrawer() {
    var at = document.body.classList.contains("reading") ? tvPage() : current;
    var here = sectionOf(Math.max(at, 0));
    var cls = ["is-part", "is-ch", "is-sec", "is-front"];
    $("#tocList").innerHTML = BOOK.toc.map(function (e) {
      return '<button type="button" class="toc-row ' + cls[e[0]] + (e === here ? " is-here" : "") + '" data-p="' + (e[2] - 1) + '"' + (e === here ? ' aria-current="true"' : "") +
        "><span>" + esc(e[0] === 3 ? t(e[1]) : e[1]) + '</span><span class="pg">' + e[2] + "</span></button>";
    }).join("");
  }
  $("#tocList").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    closeDrawer();
    if (document.body.classList.contains("reading")) showInList(+b.dataset.p, true);
    else go(+b.dataset.p);
  });

  /* ---------------------------------------------------------------
     Scrolling view: every page, one under another
     --------------------------------------------------------------- */
  var tvBuilt = false;
  function buildList() {
    if (tvBuilt) return;
    tvBuilt = true;
    var h = "";
    for (var i = 0; i < BOOK.pages; i++) {
      h += '<div class="tv__pg" id="pg' + (i + 1) + '"><span aria-hidden="true">' + (i + 1) + '</span><img src="' + src(i + 1) + '" alt="' +
        esc(i ? t("Pagina {n}").replace("{n}", i + 1) : t(BOOK.coverAlt)) + '" loading="lazy" decoding="async" width="1400" height="1977" draggable="false"></div>';
    }
    tvInner.innerHTML = h;
  }
  function showInList(i, smooth) {
    var el = tvInner.children[Math.min(i, BOOK.pages - 1)];
    if (el) tv.scrollTo({ top: el.offsetTop - 12, behavior: smooth ? "smooth" : "auto" });
  }
  function setReading(on) {
    var target = current;
    if (!on) target = tvPage();
    document.body.classList.toggle("reading", on);
    tv.classList.toggle("is-on", on);
    $("#btnRead").setAttribute("aria-pressed", on ? "true" : "false");
    $("#btnRead .lbl").textContent = on ? t("Carte") : t("Pagină cu pagină");
    if (on) {
      buildList(); applyTextZoom(false);
      showInList(current, false);
      try { history.replaceState(null, "", "#lista"); } catch (e) {}
    } else {
      buildBook(target);
    }
    updateZoomUI();
  }
  $("#btnRead").addEventListener("click", function () { setReading(!document.body.classList.contains("reading")); });
  $("#readPill").addEventListener("click", function () { setReading(true); });
  var tvT;
  tv.addEventListener("scroll", function () {
    clearTimeout(tvT);
    tvT = setTimeout(function () { var i = tvPage(); if (i > 4) try { localStorage.setItem(STORE, String(i)); } catch (e) {} }, 300);
  }, { passive: true });

  // a #pN or #lista link opened while the book is already showing
  window.addEventListener("hashchange", function () {
    var mh = /^#p(\d+)$/.exec(location.hash);
    if (location.hash === "#lista") { if (!document.body.classList.contains("reading")) setReading(true); }
    else if (mh) {
      var n = Math.max(0, Math.min(total() - 1, +mh[1] - 1));
      if (document.body.classList.contains("reading")) showInList(n, true); else if (n !== current) go(n);
    }
  });

  /* ---------------------------------------------------------------
     Start
     --------------------------------------------------------------- */
  hint.textContent = touchMode ? t("Trage pagina cu degetul ca s-o întorci · ciupește pentru mărire")
    : t("Trage de pagină sau apasă pe ea ca s-o întorci · săgețile ← → și + / −");
  ticks();
  updateZoomUI();
  var bar = $("#loadBar");
  bar.style.width = "40%";
  var h = location.hash, start = 0;
  var m = /^#p(\d+)$/.exec(h);
  if (m) start = Math.max(0, Math.min(total() - 1, +m[1] - 1));
  // the cover and the first spread before the book shows, so it never opens on blank pages
  var first = [0, start, start - 1, start + 1].filter(function (k) { return k >= 0 && k < BOOK.pages; });
  Promise.all(first.map(function (k) {
    return new Promise(function (res) { var im = new Image(); im.onload = im.onerror = res; im.src = src(k + 1); });
  })).then(function () {
    bar.style.width = "100%";
    buildBook(start);
    // lift the cover off the loading screen only once the open pages are painted
    var shown = Array.prototype.slice.call(host.querySelectorAll("img[src]")).slice(0, 8)
      .map(function (im) { return im.decode ? im.decode().catch(function () {}) : null; });
    Promise.race([Promise.all(shown), new Promise(function (r) { setTimeout(r, 1500); })])
      .then(function () { $("#loading").classList.add("is-done"); });
    var seen = false; try { seen = localStorage.getItem(STORE + "-hint") === "1"; } catch (e) {}
    if (seen || start > 0) hint.classList.add("is-gone");
    else setTimeout(dismissHint, 9000);
    if (h === "#lista") setReading(true);
    else if (!m) {
      var saved = 0; try { saved = +localStorage.getItem(STORE) || 0; } catch (e) {}
      if (saved > 4 && saved < total() - 1) {
        var toast = $("#toast");
        $("#toastText").textContent = t("Ai rămas la pagina {n}.").replace("{n}", saved + 1);
        toast.hidden = false;
        $("#toastGo").onclick = function () { toast.hidden = true; go(saved); };
        $("#toastX").onclick = function () { toast.hidden = true; };
        setTimeout(function () { toast.hidden = true; }, 12000);
      }
    }
  });
})();
