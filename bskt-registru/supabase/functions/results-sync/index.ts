// BSKT Pontaj — pulls match results + upcoming fixtures from https://3x3.bsktcup.com (Webflow, no API: HTML is parsed).
// Called by pg_cron every 15 min during game hours, hourly otherwise (x-cron-secret) and by a full admin from the app ("Sincronizează acum", user JWT).
// Body {"full":true} crawls every archive month; otherwise home page + the two newest archive months.
//
// Rules
// - only matches where BOTH teams are in our registry (echipe.slug_extern) are stored; the rest are counted as ignored
// - id_extern = "<site calendar date>T<HH:MM>|<slug A>|<slug B>"; the owners' Google Sheet (sheet-sync) is the main
//   source and this feed the fallback: it never overrides the sheet, a manual edit, a locked week or a manual deletion
// - games after midnight belong to the evening session before (data = calendar date − 1 when hour < 06:00),
//   same convention as the matches imported from the Excel
// - an unplayed fixture that vanishes from the schedule while still in the future is deleted (unless it has a roster)
import { createClient } from "npm:@supabase/supabase-js@2";
import { DOMParser, type Element } from "jsr:@b-fuze/deno-dom";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = "https://3x3.bsktcup.com";
const TZ = "Europe/Chisinau";   // the site shows Kyiv time, identical to Chisinau all year
const NIGHT_UNTIL = 6;          // hours < 6 belong to the previous day's session

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

type SiteTeam = { slug: string; name: string; logo: string };
type SiteMatch = { calDate: string; time: string; a: string; b: string; scoreA: number | null; scoreB: number | null; source: string };

const MONTHS: Record<string, number> = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
const WEEKDAYS: Record<string, number> = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 };

function nowLocal(): string {   // "YYYY-MM-DD HH:MM" in Chisinau
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date()).replace(",", "");
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
// "Wed" + "Oct 7" → ISO date; the site omits the year, so take the year whose weekday matches, closest to today
function resolveDate(weekday: string, monthDay: string, today: string): string | null {
  const m = monthDay.trim().match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})$/);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()], day = Number(m[2]);
  if (month == null) return null;
  const wd = WEEKDAYS[weekday.trim().slice(0, 3).toLowerCase()];
  const t = Date.parse(today + "T00:00:00Z"), y = Number(today.slice(0, 4));
  const candidates = [y - 1, y, y + 1].map(year => new Date(Date.UTC(year, month, day)))
    .filter(d => d.getUTCDate() === day && (wd == null || d.getUTCDay() === wd))
    .sort((p, q) => Math.abs(p.getTime() - t) - Math.abs(q.getTime() - t));
  return candidates[0]?.toISOString().slice(0, 10) ?? null;
}
function parseTime(s: string): string | null {
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}
function sessionDate(calDate: string, time: string): string {
  return Number(time.slice(0, 2)) < NIGHT_UNTIL ? addDays(calDate, -1) : calDate;
}
// Webflow asset id (24 hex) is the same for every resized variant of a logo
function assetId(src: string | null | undefined): string | null {
  return src?.match(/\/([0-9a-f]{24})_/)?.[1] ?? null;
}
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

async function fetchDoc(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": "BSKT-Pontaj results sync (+https://3x3.bsktcup.com)" } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), "text/html");
  if (!doc) throw new Error(`${url} → unparsable HTML`);
  return doc;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // auth: pg_cron secret, or a signed-in full admin
  const cronSecret = (await admin.rpc("get_secret", { p_name: "cron_secret" })).data as string | null;
  let authorized = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  if (!authorized) {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (token) {
      const { data: u } = await admin.auth.getUser(token);
      if (u?.user) {
        const { data: a } = await admin.from("administratori").select("rol").eq("id", u.user.id).maybeSingle();
        authorized = a?.rol === "admin";
      }
    }
  }
  if (!authorized) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const full = body?.full === true;
  const now = nowLocal(), today = now.slice(0, 10);
  const stats = { complet: full, ok: false, pagini: 0, gasite: 0, inserate: 0, actualizate: 0, sterse: 0, ignorate: 0 };
  const detalii: Record<string, unknown> = { ignorate: [] as string[], egal: [] as string[], logo: [] as string[] };

  try {
    // ── 1. scrape ──────────────────────────────────────────────
    const home = await fetchDoc(SITE + "/"); stats.pagini++;

    const siteTeams: SiteTeam[] = [];
    for (const item of home.querySelectorAll("#teams .w-dyn-item")) {
      const href = (item as Element).querySelector("a[href^='/teams/']")?.getAttribute("href") ?? "";
      const slug = href.replace(/^\/teams\//, "").replace(/\/$/, "");
      const logo = (item as Element).querySelector("img")?.getAttribute("src") ?? "";
      if (slug) siteTeams.push({ slug, name: text((item as Element).querySelector(".team-name")), logo });
    }
    if (!siteTeams.length) throw new Error("no teams found on the home page — site layout changed?");
    const slugByAsset = new Map<string, string>(), slugByName = new Map<string, string>();
    for (const tm of siteTeams) {
      const id = assetId(tm.logo); if (id) slugByAsset.set(id, tm.slug);
      slugByName.set(norm(tm.name), tm.slug); slugByName.set(norm(tm.slug), tm.slug);
    }
    const teamSlug = (img: Element | null, name?: string) =>
      slugByAsset.get(assetId(img?.getAttribute("src")) ?? "") ?? slugByName.get(norm(name || img?.getAttribute("alt") || "")) ?? null;

    const found: SiteMatch[] = [];
    const unknownTeams = new Set<string>();
    const push = (wd: string, md: string, tm: string, a: string | null, b: string | null, sa: number | null, sb: number | null, source: string, raw: string) => {
      const calDate = resolveDate(wd, md, today), time = parseTime(tm);
      if (!calDate || !time) { ((detalii.unparsable ??= []) as string[]).push(raw); return; }
      if (!a || !b) { unknownTeams.add(raw); return; }
      found.push({ calDate, time, a, b, scoreA: sa, scoreB: sb, source });
    };
    const score = (el: Element | null) => { const n = parseInt(text(el), 10); return Number.isFinite(n) ? n : null; };

    // upcoming fixtures
    let scheduleCount = 0;
    for (const it of home.querySelectorAll("#future-matches .match-item")) {
      const el = it as Element;
      const sides = [...el.querySelectorAll(".team-cont-left")] as Element[];
      const dt = [...el.querySelectorAll(".match-centr .date-text")].map(x => text(x as Element));
      if (sides.length !== 2 || dt.length < 3) continue;
      scheduleCount++;
      const [na, nb] = sides.map(s => text(s.querySelector(".team-name")));
      push(dt[0], dt[1], dt[2], teamSlug(sides[0].querySelector("img"), na), teamSlug(sides[1].querySelector("img"), nb), null, null, "schedule", `${na} vs ${nb} ${dt.join(" ")}`);
    }
    // latest results on the home page
    for (const it of home.querySelectorAll("#results .latest-item")) {
      const el = it as Element;
      const sides = [...el.querySelectorAll(".score-team")] as Element[];
      const dt = [...el.querySelectorAll(".latest-date")].map(x => text(x as Element));
      if (sides.length !== 2 || dt.length < 3) continue;
      const [ia, ib] = sides.map(s => s.querySelector("img"));
      push(dt[0], dt[1], dt[2], teamSlug(ia), teamSlug(ib), score(sides[0].querySelector(".latest-big-nimber")), score(sides[1].querySelector(".latest-big-nimber")),
        "home", `${ia?.getAttribute("alt")} vs ${ib?.getAttribute("alt")} ${dt.join(" ")}`);
    }

    // archive months (+ Webflow pagination)
    const archive = await fetchDoc(SITE + "/archive"); stats.pagini++;
    const monthKey = (href: string) => {
      const m = href.match(/\/archive\/([a-z]+)-(\d{4})/i);
      const idx = m ? ["january","february","march","april","may","june","july","august","september","october","november","december"].indexOf(m[1].toLowerCase()) : -1;
      return m ? Number(m[2]) * 12 + idx : 0;
    };
    let months = [...new Set([...archive.querySelectorAll("a[href^='/archive/']")].map(a => (a as Element).getAttribute("href")!))]
      .sort((p, q) => monthKey(q) - monthKey(p));
    if (!full) months = months.slice(0, 2);
    for (const m of months) {
      let url: string | null = SITE + m;
      for (let page = 0; url && page < 50; page++) {
        const doc = await fetchDoc(url); stats.pagini++;
        for (const it of doc.querySelectorAll(".arch-game")) {
          const el = it as Element;
          const sides = [...el.querySelectorAll(".arch-logo-score")] as Element[];
          const dt = [...el.querySelectorAll(".arch-middle-text")].map(x => text(x as Element));
          if (sides.length !== 2 || dt.length < 3) continue;
          const [ia, ib] = sides.map(s => s.querySelector("img"));
          push(dt[0], dt[1], dt[2], teamSlug(ia), teamSlug(ib), score(sides[0].querySelector(".arch-score-text")), score(sides[1].querySelector(".arch-score-text")),
            "archive", `${ia?.getAttribute("alt")} vs ${ib?.getAttribute("alt")} ${dt.join(" ")}`);
        }
        const next = (doc.querySelector("a.w-pagination-next") as Element | null)?.getAttribute("href");
        url = next ? new URL(next, url).toString() : null;
      }
    }

    // one entry per fixture; a played result beats the schedule entry
    const byKey = new Map<string, SiteMatch>();
    for (const f of found) {
      const key = `${f.calDate}T${f.time}|${f.a}|${f.b}`;
      const prev = byKey.get(key);
      if (!prev || (prev.scoreA == null && f.scoreA != null)) byKey.set(key, f);
    }
    stats.gasite = byKey.size;

    // ── 2. map onto our registry ───────────────────────────────
    const { data: echipe, error: eErr } = await admin.from("echipe").select("id,nume,slug_extern,logo_url");
    if (eErr) throw eErr;
    const teamIdBySlug = new Map((echipe ?? []).filter(e => e.slug_extern).map(e => [e.slug_extern as string, e.id as string]));

    // keep our logos in step with the site (colour is curated by hand, not touched). The URL ends up in the
    // app's markup, so only a plain https image on the site's Webflow CDN is accepted.
    const safeLogo = (u: string) => /^https:\/\/cdn\.prod\.website-files\.com\/[A-Za-z0-9._~%\/-]+\.(svg|png|jpe?g|webp|avif)$/i.test(u);
    for (const e of echipe ?? []) {
      const st = siteTeams.find(s => s.slug === e.slug_extern);
      if (st?.logo && safeLogo(st.logo) && st.logo !== e.logo_url) {
        await admin.from("echipe").update({ logo_url: st.logo }).eq("id", e.id);
        (detalii.logo as string[]).push(e.nume);
      }
    }

    const wanted: { key: string; data: string; ora: string; a: string; b: string; sa: number | null; sb: number | null; kickoff: string }[] = [];
    for (const [key, f] of byKey) {
      const a = teamIdBySlug.get(f.a), b = teamIdBySlug.get(f.b);
      if (!a || !b) { stats.ignorate++; (detalii.ignorate as string[]).push(key); continue; }
      if (f.scoreA != null && f.scoreA === f.scoreB) { (detalii.egal as string[]).push(key); continue; }   // 3×3 has no draws
      wanted.push({ key, data: sessionDate(f.calDate, f.time), ora: f.time, a, b, sa: f.scoreA, sb: f.scoreB, kickoff: `${f.calDate} ${f.time}` });
    }
    if (unknownTeams.size) detalii.echipeNecunoscute = [...unknownTeams];

    // ── 3. upsert ──────────────────────────────────────────────
    // The owners' Google Sheet is the main source (sheet-sync); this feed is the fallback. It never touches a match
    // the sheet owns (sursa 'tabel'), a match changed by hand since the last sync wrote it (sync_baza differs),
    // a match in a locked week, or a match someone deleted by hand (meciuri_sterse).
    const dates = wanted.map(w => w.data).sort();
    const existing = dates.length ? (await admin.from("meciuri")
      .select("id,data,ora,echipa_a_id,echipa_b_id,scor_a,scor_b,prelungiri,sursa,id_extern,sync_baza")
      .gte("data", dates[0]).lte("data", dates[dates.length - 1])).data ?? [] : [];
    const byExt = new Map(existing.filter(m => m.id_extern).map(m => [m.id_extern as string, m]));
    const stamp = new Date().toISOString();
    const lockedWeeks = new Set(((await admin.from("saptamani_blocate").select("luni")).data ?? []).map(r => r.luni as string));
    const mondayOf = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };
    const isLocked = (day: string) => lockedWeeks.has(mondayOf(day));
    const deleted = new Set(((await admin.from("meciuri_sterse").select("cheie").like("cheie", "site:%")).data ?? []).map(r => r.cheie as string));
    const baseOf = (m: any) => ({ data: m.data, ora: String(m.ora ?? "").slice(0, 5), a: m.echipa_a_id, b: m.echipa_b_id, sa: m.scor_a, sb: m.scor_b, ot: !!m.prelungiri });
    const changedByHand = (m: any) => {
      const b = m.sync_baza; if (!b || !b.data) return false;
      const c = baseOf(m);
      return b.data !== c.data || b.ora !== c.ora || b.a !== c.a || b.b !== c.b || (b.sa ?? null) !== (c.sa ?? null) || (b.sb ?? null) !== (c.sb ?? null) || !!b.ot !== c.ot;
    };
    // a slot the owners' sheet already fills with a DIFFERENT game: the site's version is not added (fallback only)
    const sheetSlotTaken = (day: string, ora: string, a: string, b: string) => existing.some(m => m.sursa === "tabel" && m.data === day &&
      String(m.ora ?? "").slice(0, 5) === ora && !((m.echipa_a_id === a && m.echipa_b_id === b) || (m.echipa_a_id === b && m.echipa_b_id === a)));
    const skipped = { tabel: 0, manual: 0, blocat: 0, sters: 0, ocupat_tabel: 0, curatate: 0 };

    for (const w of wanted) {
      if (deleted.has(`site:${w.key}`)) { skipped.sters++; continue; }
      const cur = byExt.get(w.key);
      if (cur) {
        if (cur.sursa === "tabel") { skipped.tabel++; continue; }
        if (w.sa != null && (cur.scor_a !== w.sa || cur.scor_b !== w.sb)) {
          if (changedByHand(cur)) { skipped.manual++; continue; }
          if (isLocked(cur.data)) { skipped.blocat++; continue; }
          const next = { ...baseOf(cur), sa: w.sa, sb: w.sb };
          const { error } = await admin.from("meciuri").update({ scor_a: w.sa, scor_b: w.sb, sincronizat_la: stamp,
            sync_baza: { ...next, lot: cur.sync_baza?.lot ?? {} } }).eq("id", cur.id);
          if (error) throw error;
          stats.actualizate++;
        }
        continue;
      }
      // a match already in the app (typed by hand, or created from the sheet): same session day, time and teams → link it
      const manual = existing.find(m => !m.id_extern && m.data === w.data && String(m.ora ?? "").slice(0, 5) === w.ora &&
        ((m.echipa_a_id === w.a && m.echipa_b_id === w.b) || (m.echipa_a_id === w.b && m.echipa_b_id === w.a)));
      if (manual) {
        if (isLocked(manual.data)) { skipped.blocat++; continue; }
        const patch: Record<string, unknown> = { id_extern: w.key, sincronizat_la: stamp };
        // the sheet's score, or a score someone typed, wins over the site's
        if (w.sa != null && manual.sursa !== "tabel" && manual.scor_a == null) {
          const flipped = manual.echipa_a_id === w.b;
          patch.scor_a = flipped ? w.sb : w.sa; patch.scor_b = flipped ? w.sa : w.sb;
          patch.sync_baza = { ...baseOf(manual), sa: patch.scor_a, sb: patch.scor_b, lot: manual.sync_baza?.lot ?? {} };
        }
        const { error } = await admin.from("meciuri").update(patch).eq("id", manual.id);
        if (error) throw error;
        manual.id_extern = w.key;
        stats.actualizate++;
        continue;
      }
      if (isLocked(w.data)) { skipped.blocat++; continue; }
      if (sheetSlotTaken(w.data, w.ora, w.a, w.b)) { skipped.ocupat_tabel++; continue; }
      const { error } = await admin.from("meciuri").insert({
        data: w.data, ora: w.ora, echipa_a_id: w.a, echipa_b_id: w.b, scor_a: w.sa, scor_b: w.sb,
        sursa: "bsktcup", id_extern: w.key, sincronizat_la: stamp,
        sync_baza: { data: w.data, ora: w.ora, a: w.a, b: w.b, sa: w.sa, sb: w.sb, ot: false, lot: {} },
      });
      if (error) throw error;
      stats.inserate++;
    }
    // site-only games sitting in a slot where the sheet has a different game were the site's mistakes: remove them,
    // unless someone gave them a line-up, edited them by hand, or the week is locked
    for (const m of existing) {
      if (m.sursa !== "bsktcup" || !sheetSlotTaken(m.data, String(m.ora ?? "").slice(0, 5), m.echipa_a_id, m.echipa_b_id)) continue;
      if (changedByHand(m) || isLocked(m.data)) continue;
      const { count } = await admin.from("meci_jucatori").select("id", { count: "exact", head: true }).eq("meci_id", m.id);
      if (count) continue;
      const { error } = await admin.from("meciuri").delete().eq("id", m.id);
      if (!error) { skipped.curatate++; stats.sterse++; }
    }
    detalii.sarite = skipped;

    // ── 4. drop future fixtures that left the schedule (rescheduled / cancelled) ──
    if (scheduleCount > 0) {
      const seen = new Set(wanted.map(w => w.key));
      const { data: pending } = await admin.from("meciuri").select("id,id_extern,data,ora,echipa_a_id,echipa_b_id,scor_a,scor_b,prelungiri,sync_baza")
        .eq("sursa", "bsktcup").is("scor_a", null).gte("data", addDays(today, -1));
      for (const p of pending ?? []) {
        const k = p.id_extern as string | null;
        if (!k || seen.has(k) || changedByHand(p) || isLocked(p.data)) continue;   // edited by hand or locked — keep
        const kickoff = k.slice(0, 16).replace("T", " ");
        if (kickoff <= now) continue;                       // played but result not published yet — keep
        const { count } = await admin.from("meci_jucatori").select("id", { count: "exact", head: true }).eq("meci_id", p.id);
        if (count) continue;                                // a roster is attached — keep
        await admin.from("meciuri").delete().eq("id", p.id);
        stats.sterse++;
      }
    }

    stats.ok = true;
    await admin.from("sync_rezultate").insert({ ...stats, detalii });
    return json(stats);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("sync_rezultate").insert({ ...stats, ok: false, eroare: msg, detalii });
    return json({ ...stats, error: msg }, 500);
  }
});
