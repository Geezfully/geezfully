// BSKT Registru — sync with the owners' Google Sheet (see migration 20261009100000_sincronizare_tabel).
// Source: the sheet's Apps Script web app (supabase/apps-script/bskt-registru-sync.gs), URL + key in tabel_config.
// Auth: x-cron-secret (pg_cron, or tests that may pass {payload} directly) or a signed-in full admin.
// Body: { dryRun?: boolean, payload?: SheetPayload }  — dryRun reports every change without writing anything.
//
// Rules
// - the sheet is the source of truth for results (FINAL SCORE rows; TEST rows skipped), line-ups (PD_dd.mm.yyyy
//   blocks), ratings ("Level") and teams ("Player data"); 3x3.bsktcup.com stays a fallback (results-sync)
// - manual changes win: a value is written only while it still equals what the last sync wrote (sync_baza,
//   rating_sync, echipa_sync); otherwise the difference is reported as a conflict and left alone
// - a match deleted by hand (meciuri_sterse) is never re-created; a locked week is never touched
// - names are linked automatically only on an exact match (any word order, no diacritics); everything else
//   waits in tabel_jucatori for an admin to confirm, and a line-up side with an unconfirmed name waits too
// - captain = highest Level in the side (first listed on a tie), everyone else "jucător"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NIGHT_UNTIL = 6;
const TEAM_ALIASES: Record<string, string> = { "rim runners": "runners", "team tempo": "tempo", "half court bulls": "hc bulls" };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });

type Juc = [string, string, string];            // [jersey, name, level]
type Block = { nr: string; data: string; ora: string; castigator: string; a: string; b: string; jucA: Juc[]; jucB: Juc[] };
type SheetPayload = { rezultate: string[][]; zile: { foaie: string; blocuri: Block[] }[]; jucatori: string[][] };
type Baza = { data?: string; ora?: string; a?: string; b?: string; sa?: number | null; sb?: number | null; ot?: boolean; lot?: Record<string, string[]> };

// ───────── parsing helpers ─────────
const strip = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const words = (s: string) => strip(s).replace(/[^a-z ]+/g, " ").split(/\s+/).filter(Boolean);
const nameKey = (s: string) => words(s).sort().join(" ");
function fold(t: string) {  // transliteration-tolerant skeleton: Kirill/Chiril, Volcianov/Volchanov, Dmitrii/Dmytro…
  for (const [a, b] of [["kh", "h"], ["sh", "s"], ["ch", "c"], ["ck", "c"], ["k", "c"], ["y", "i"], ["ii", "i"], ["iu", "u"], ["yu", "u"], ["w", "v"], ["ph", "f"], ["x", "cs"]]) t = t.split(a).join(b);
  return t.replace(/(.)\1+/g, "$1");
}
function similarity(a: string, b: string) {   // Ratcliff/Obershelp, like Python's difflib ratio
  const m = (x: string, y: string): number => {
    if (!x || !y) return 0;
    let best = 0, bi = 0, bj = 0;
    for (let i = 0; i < x.length; i++) for (let j = 0; j < y.length; j++) {
      let k = 0; while (i + k < x.length && j + k < y.length && x[i + k] === y[j + k]) k++;
      if (k > best) { best = k; bi = i; bj = j; }
    }
    return best ? best + m(x.slice(0, bi), y.slice(0, bj)) + m(x.slice(bi + best), y.slice(bj + best)) : 0;
  };
  return (2 * m(a, b)) / (a.length + b.length || 1);
}
function parseDate(s: string): string | null {   // "29.09.2026" | "2026-09-29" | "29/09/2026"
  let m = s.trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function parseTime(s: string): string | null {
  const m = String(s || "").match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}
const num = (s: string) => { const n = Number(String(s ?? "").replace(",", ".").trim()); return String(s ?? "").trim() !== "" && Number.isFinite(n) ? n : null; };
function addDays(iso: string, n: number) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const sessionDate = (cal: string, time: string) => Number(time.slice(0, 2)) < NIGHT_UNTIL ? addDays(cal, -1) : cal;
const mondayOf = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };
const pairKey = (day: string, ora: string, x: string, y: string) => `${day}|${ora}|${[x, y].sort().join("|")}`;

async function selectAll<T>(q: () => any): Promise<T[]> {   // PostgREST caps a request at 1000 rows
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const db: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // ── auth ──
  const cronSecret = (await db.rpc("get_secret", { p_name: "cron_secret" })).data as string | null;
  const viaCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  let adminId: string | null = null;
  if (!viaCron) {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const { data: u } = token ? await db.auth.getUser(token) : { data: null };
    if (u?.user) {
      const { data: a } = await db.from("administratori").select("rol").eq("id", u.user.id).maybeSingle();
      if (a?.rol === "admin") adminId = u.user.id;
    }
    if (!adminId) return json({ error: "unauthorized" }, 401);
  }
  const body = await req.json().catch(() => ({})) as { dryRun?: boolean; payload?: SheetPayload };
  const dry = body.dryRun === true;

  const raport: Record<string, unknown[]> = { conflicte: [], blocate: [], nume_noi: [], loturi_in_asteptare: [], echipe_necunoscute: [], schimbari: [], erori: [] };
  const stats = { complet: true, ok: false, pagini: 0, gasite: 0, inserate: 0, actualizate: 0, sterse: 0, ignorate: 0 };
  const note = (k: string, v: unknown) => (raport[k] as unknown[]).push(v);

  try {
    // ── 1. fetch the sheet ──
    let sheet: SheetPayload;
    if (body.payload && viaCron) sheet = body.payload;
    else {
      const { data: cfg } = await db.from("tabel_config").select("url,cheie,activ").maybeSingle();
      if (!cfg?.url || !cfg?.cheie) return json({ error: "not_configured" }, 400);
      const res = await fetch(`${cfg.url}?cheie=${encodeURIComponent(cfg.cheie)}`, { redirect: "follow" });
      if (!res.ok) throw new Error(`Tabel: HTTP ${res.status}`);
      const parsed = await res.json().catch(() => null) as SheetPayload & { error?: string } | null;
      if (!parsed || parsed.error) throw new Error(`Tabel: ${parsed?.error ?? "răspuns invalid"}`);
      sheet = parsed;
    }
    stats.pagini = 1 + (sheet.zile?.length ?? 0);

    // ── 2. registry state ──
    const echipe = await selectAll<{ id: string; nume: string; slug_extern: string | null }>(() => db.from("echipe").select("id,nume,slug_extern").order("id"));
    const teamByName = new Map<string, string>();
    for (const e of echipe) { teamByName.set(e.nume.toLowerCase(), e.id); if (e.slug_extern) teamByName.set(e.slug_extern.replace(/-/g, " "), e.id); }
    const teamId = (name: string) => { const k = String(name || "").trim().toLowerCase(); return teamByName.get(TEAM_ALIASES[k] ?? k) ?? null; };
    const teamName = (id: string) => echipe.find(e => e.id === id)?.nume ?? id;

    const players = await selectAll<{ id: string; nume: string; prenume: string; rating: number | null; rating_sync: number | null; echipa_id: string | null; echipa_sync: string | null }>(
      () => db.from("participanti").select("id,nume,prenume,rating,rating_sync,echipa_id,echipa_sync").order("id"));
    const playerName = (id: string) => { const p = players.find(x => x.id === id); return p ? `${p.nume} ${p.prenume}` : id; };
    const byExactKey = new Map<string, string[]>();
    for (const p of players) { const k = nameKey(`${p.nume} ${p.prenume}`); byExactKey.set(k, [...(byExactKey.get(k) ?? []), p.id]); }

    const mapRows = await selectAll<{ cheie: string; nume: string; participant_id: string | null; status: string; aparitii: number }>(
      () => db.from("tabel_jucatori").select("cheie,nume,participant_id,status,aparitii").order("cheie"));
    const nameMap = new Map(mapRows.map(r => [r.cheie, r]));
    const locked = new Set((await selectAll<{ luni: string }>(() => db.from("saptamani_blocate").select("luni").order("luni"))).map(r => r.luni));
    const isLocked = (day: string | null | undefined) => !!day && locked.has(mondayOf(day));
    const tomb = new Set((await selectAll<{ cheie: string }>(() => db.from("meciuri_sterse").select("cheie").order("cheie"))).map(r => r.cheie));

    // ── 3. names: auto-link exact matches, queue the rest ──
    const seen = new Map<string, { nume: string; echipa: string; rating: number | null; n: number; prima: string | null; ultima: string | null; lot: boolean }>();
    const see = (nume: string, echipa: string, rating: number | null, day: string | null, inLot = true) => {
      const k = nameKey(nume); if (!k) return;
      const s = seen.get(k) ?? { nume: nume.trim(), echipa, rating, n: 0, prima: day, ultima: day, lot: false };
      if (inLot) { s.n++; s.lot = true; } if (echipa) s.echipa = echipa; if (rating != null) s.rating = rating;
      if (day && (!s.prima || day < s.prima)) s.prima = day; if (day && (!s.ultima || day > s.ultima)) s.ultima = day;
      seen.set(k, s);
    };
    for (const z of sheet.zile ?? []) for (const b of z.blocuri ?? []) {
      const cal = parseDate(b.data), t = parseTime(b.ora); const day = cal && t ? sessionDate(cal, t) : cal;
      b.jucA.forEach(j => see(j[1], b.a, num(j[2]), day)); b.jucB.forEach(j => see(j[1], b.b, num(j[2]), day));
    }
    for (const r of sheet.jucatori ?? []) see(r[0], r[2], num(r[1]), null, false);

    const resolved = new Map<string, string>();     // cheie → participant id
    const upserts: Record<string, unknown>[] = [];
    for (const [k, s] of seen) {
      const row = nameMap.get(k);
      const base = { cheie: k, nume: s.nume, echipa: s.echipa || null, rating: s.rating, aparitii: s.n, prima_data: s.prima, ultima_data: s.ultima };
      if (row) {
        if (row.participant_id && row.status !== "in_asteptare") resolved.set(k, row.participant_id);
        upserts.push({ ...base, status: row.status, participant_id: row.participant_id });
        continue;
      }
      const exact = byExactKey.get(k) ?? [];
      // someone only listed in "Player data", with no team and no game, is not needed yet — don't queue them
      if (exact.length !== 1 && !s.lot && !teamId(s.echipa)) continue;
      if (exact.length === 1) {
        resolved.set(k, exact[0]);
        upserts.push({ ...base, status: "auto", participant_id: exact[0] });
        continue;
      }
      const fk = words(s.nume).map(fold).sort().join(" ");
      let best = { id: null as string | null, scor: 0 };
      for (const p of players) {
        const sc = similarity(fk, words(`${p.nume} ${p.prenume}`).map(fold).sort().join(" "));
        if (sc > best.scor) best = { id: p.id, scor: sc };
      }
      const propunere = best.scor >= 0.72 ? best.id : null;
      upserts.push({ ...base, status: "in_asteptare", participant_id: null, propunere_id: propunere, scor: Math.round(best.scor * 100) / 100 });
      note("nume_noi", { nume: s.nume, echipa: s.echipa, propunere: propunere ? playerName(propunere) : null, scor: Math.round(best.scor * 100) / 100 });
    }
    if (!dry && upserts.length) {
      for (let i = 0; i < upserts.length; i += 500) {
        const { error } = await db.from("tabel_jucatori").upsert(upserts.slice(i, i + 500), { onConflict: "cheie" });
        if (error) throw error;
      }
    }

    // ── 4. ratings and teams from "Player data" (only while unchanged by hand) ──
    for (const r of sheet.jucatori ?? []) {
      const pid = resolved.get(nameKey(r[0])); if (!pid) continue;
      const p = players.find(x => x.id === pid); if (!p) continue;
      const patch: Record<string, unknown> = {};
      const lvl = num(r[1]);
      if (lvl != null && lvl >= 0 && lvl <= 100 && p.rating !== lvl) {
        if (p.rating_sync == null || p.rating === p.rating_sync) { patch.rating = lvl; patch.rating_sync = lvl; }
        else note("conflicte", { tip: "rating", jucator: playerName(pid), aplicatie: p.rating, tabel: lvl });
      } else if (lvl != null && p.rating_sync !== lvl && p.rating === lvl) patch.rating_sync = lvl;
      const tid = r[2] ? teamId(r[2]) : null;
      if (r[2] && !tid) note("echipe_necunoscute", r[2]);
      if (tid && p.echipa_id !== tid) {
        if (p.echipa_sync == null || p.echipa_id === p.echipa_sync) { patch.echipa_id = tid; patch.echipa_sync = tid; if (p.echipa_id) { patch.rol_echipa = "jucător"; patch.nr_echipa = null; } }
        else note("conflicte", { tip: "echipă", jucator: playerName(pid), aplicatie: p.echipa_id ? teamName(p.echipa_id) : null, tabel: r[2] });
      } else if (tid && p.echipa_sync !== tid && p.echipa_id === tid) patch.echipa_sync = tid;
      if (Object.keys(patch).length) {
        if ("rating" in patch || "echipa_id" in patch) note("schimbari", { jucator: playerName(pid), ...("rating" in patch ? { rating: `${p.rating ?? "—"} → ${patch.rating}` } : {}), ...("echipa_id" in patch ? { echipa: `${p.echipa_id ? teamName(p.echipa_id) : "—"} → ${teamName(patch.echipa_id as string)}` } : {}) });
        if (!dry) { const { error } = await db.from("participanti").update(patch).eq("id", pid); if (error) note("erori", `${playerName(pid)}: ${error.message}`); }
      }
    }

    // ── 5. results ──
    const rows = (sheet.rezultate ?? []).map(r => {
      const nr = num(r[0]); const cal = parseDate(r[1]); const ora = parseTime(r[3]) ?? parseTime(r[2]);
      return { nr, cal, ora, status: String(r[4] || "").trim().toUpperCase(), ta: r[5], tb: r[6], ra: num(r[11]), rb: num(r[12]), ota: num(r[9]), otb: num(r[10]) };
    }).filter(r => r.nr != null && r.cal && r.ora && r.status !== "TEST");
    const days = rows.map(r => sessionDate(r.cal!, r.ora!)).sort();
    const fromDay = days[0] ?? "2026-01-01";
    const matches = await selectAll<any>(() => db.from("meciuri").select("id,nr,data,ora,echipa_a_id,echipa_b_id,scor_a,scor_b,prelungiri,sursa,id_extern,sync_baza").gte("data", addDays(fromDay, -1)).order("id"));
    const byNr = new Map(matches.filter(m => m.nr != null).map(m => [Number(m.nr), m]));
    const byPair = new Map<string, any>();
    for (const m of matches) byPair.set(pairKey(m.data, String(m.ora ?? "").slice(0, 5), m.echipa_a_id, m.echipa_b_id), m);
    const stamp = new Date().toISOString();
    const cur = (m: any) => ({ data: m.data, ora: String(m.ora ?? "").slice(0, 5), a: m.echipa_a_id, b: m.echipa_b_id, sa: m.scor_a, sb: m.scor_b, ot: !!m.prelungiri });
    const same = (x: Baza, y: Baza) => x.data === y.data && x.ora === y.ora && x.a === y.a && x.b === y.b && (x.sa ?? null) === (y.sa ?? null) && (x.sb ?? null) === (y.sb ?? null) && !!x.ot === !!y.ot;

    for (const r of rows) {
      const a = teamId(r.ta), b = teamId(r.tb);
      if (!a || !b) { if (!a) note("echipe_necunoscute", r.ta); if (!b) note("echipe_necunoscute", r.tb); stats.ignorate++; continue; }
      if (a === b) continue;
      stats.gasite++;
      if (tomb.has(`nr:${r.nr}`)) continue;                                  // deleted by hand — stays deleted
      const final = r.status === "FINAL SCORE" && r.ra != null && r.rb != null && r.ra !== r.rb;
      const day = sessionDate(r.cal!, r.ora!);
      const want: Baza = { data: day, ora: r.ora!, a, b, sa: final ? r.ra : null, sb: final ? r.rb : null, ot: final && ((r.ota ?? 0) + (r.otb ?? 0)) > 0 };
      let m = byNr.get(r.nr!) ?? byPair.get(pairKey(day, r.ora!, a, b));
      if (m && m.nr != null && Number(m.nr) !== r.nr) m = undefined;          // a different numbered match at the same slot
      if (!m) {
        if (!final && day < addDays(new Date().toISOString().slice(0, 10), -1)) continue;   // old unplayed rows: nothing to add
        if (isLocked(day)) { note("blocate", { nr: r.nr, data: day, motiv: "meci nou într-o săptămână blocată" }); continue; }
        note("schimbari", { nr: r.nr, nou: `${r.ta} – ${r.tb}`, data: day, ora: r.ora, scor: final ? `${r.ra}:${r.rb}` : null });
        if (!dry) {
          const { data: ins, error } = await db.from("meciuri").insert({ nr: r.nr, data: day, ora: r.ora, echipa_a_id: a, echipa_b_id: b, scor_a: want.sa, scor_b: want.sb,
            prelungiri: want.ot, sursa: "tabel", sync_baza: { ...want, lot: {} }, sincronizat_la: stamp, tabel_actualizat_la: stamp }).select("*").single();
          if (error) { note("erori", `#${r.nr}: ${error.message}`); continue; }
          matches.push(ins); byNr.set(r.nr!, ins); byPair.set(pairKey(day, r.ora!, a, b), ins);
        } else { const fake = { id: `nou-${r.nr}`, nr: r.nr, ...{ data: day, ora: r.ora, echipa_a_id: a, echipa_b_id: b, scor_a: want.sa, scor_b: want.sb }, sync_baza: { ...want, lot: {} } }; byNr.set(r.nr!, fake); byPair.set(pairKey(day, r.ora!, a, b), fake); }
        stats.inserate++;
        continue;
      }
      const now = cur(m);
      const baza: Baza | null = m.sync_baza && m.sync_baza.data ? m.sync_baza : null;
      const untouched = !baza || same(now, baza);
      // a not-yet-final sheet row never wipes a score that the site feed or a person already entered
      if (!final) { want.sa = now.sa; want.sb = now.sb; want.ot = now.ot; }
      const patch: Record<string, unknown> = {};
      if (m.nr == null) patch.nr = r.nr;
      if (!same(now, want)) {
        if (!untouched) note("conflicte", { tip: "meci", nr: r.nr, aplicatie: `${teamName(now.a!)} ${now.sa ?? "–"}:${now.sb ?? "–"} ${teamName(now.b!)} · ${now.data} ${now.ora}`, tabel: `${r.ta} ${want.sa ?? "–"}:${want.sb ?? "–"} ${r.tb} · ${day} ${r.ora}` });
        else if (isLocked(now.data) || isLocked(day)) note("blocate", { nr: r.nr, data: now.data, motiv: "scor/dată diferite în tabel" });
        else {
          Object.assign(patch, { data: want.data, ora: want.ora, echipa_a_id: want.a, echipa_b_id: want.b, scor_a: want.sa, scor_b: want.sb, prelungiri: want.ot });
          note("schimbari", { nr: r.nr, inainte: `${teamName(now.a!)} ${now.sa ?? "–"}:${now.sb ?? "–"} ${teamName(now.b!)}${now.ot ? " (OT)" : ""} · ${now.data} ${now.ora}`, dupa: `${r.ta} ${want.sa ?? "–"}:${want.sb ?? "–"} ${r.tb}${want.ot ? " (OT)" : ""} · ${want.data} ${want.ora}` });
        }
      }
      // remember what the sheet says (only when it changed, so a quiet run writes nothing)
      if (untouched && !isLocked(now.data) && (!baza || !same(baza, want) || m.sursa !== "tabel")) {
        patch.sync_baza = { ...want, lot: baza?.lot ?? {} }; patch.sursa = "tabel"; patch.tabel_actualizat_la = stamp;
      }
      if (Object.keys(patch).length && !isLocked(now.data)) {
        if (!dry) {
          // teams change → the old line-up no longer fits the pay trigger; clear it first (it is rebuilt from the sheet below)
          if (("echipa_a_id" in patch && patch.echipa_a_id !== now.a && patch.echipa_a_id !== now.b) || ("echipa_b_id" in patch && patch.echipa_b_id !== now.a && patch.echipa_b_id !== now.b))
            await db.from("meci_jucatori").delete().eq("meci_id", m.id);
          const { data: up, error } = await db.from("meciuri").update(patch).eq("id", m.id).select("*").single();
          if (error) { note("erori", `#${r.nr}: ${error.message}`); continue; }
          Object.assign(m, up);
        } else Object.assign(m, { nr: m.nr ?? r.nr, sync_baza: patch.sync_baza ?? m.sync_baza, data: patch.data ?? m.data, ora: patch.ora ?? m.ora, echipa_a_id: patch.echipa_a_id ?? m.echipa_a_id, echipa_b_id: patch.echipa_b_id ?? m.echipa_b_id });
        if ("scor_a" in patch || "data" in patch) stats.actualizate++;
        byPair.set(pairKey(m.data, String(m.ora ?? "").slice(0, 5), m.echipa_a_id, m.echipa_b_id), m);
      }
    }

    // ── 6. line-ups ──
    const realIds = matches.map(m => m.id).filter((id: string) => !String(id).startsWith("nou-"));
    const roster = new Map<string, { echipa_id: string; participant_id: string; rol: string }[]>();
    for (let i = 0; i < realIds.length; i += 200) {
      const chunk = realIds.slice(i, i + 200);
      const rows2 = await selectAll<any>(() => db.from("meci_jucatori").select("meci_id,echipa_id,participant_id,rol").in("meci_id", chunk).order("meci_id"));
      for (const x of rows2) roster.set(x.meci_id, [...(roster.get(x.meci_id) ?? []), x]);
    }
    const sideKey = (list: { participant_id: string; rol: string }[]) => list.map(x => `${x.participant_id}:${x.rol}`).sort();
    for (const z of sheet.zile ?? []) for (const blk of z.blocuri ?? []) {
      const cal = parseDate(blk.data), t = parseTime(blk.ora);
      const a = teamId(blk.a), b = teamId(blk.b);
      if (!cal || !t || !a || !b) continue;
      const day = sessionDate(cal, t);
      const m = byPair.get(pairKey(day, t, a, b));
      if (!m) continue;                                                       // no match for this block (TEST day, or not in Results yet)
      for (const [tid, juc, label] of [[a, blk.jucA, blk.a], [b, blk.jucB, blk.b]] as [string, Juc[], string][]) {
        if (!juc.length) continue;
        const ids: string[] = []; const missing: string[] = [];
        juc.forEach(j => { const pid = resolved.get(nameKey(j[1])); if (pid) ids.push(pid); else missing.push(j[1].trim()); });
        if (missing.length) { note("loturi_in_asteptare", { nr: m.nr, data: day, ora: t, echipa: label, nume: missing }); continue; }
        if (new Set(ids).size !== ids.length) { note("erori", `#${m.nr} ${label}: același jucător apare de două ori`); continue; }
        let cap = 0; juc.forEach((j, i) => { if ((num(j[2]) ?? -1) > (num(juc[cap][2]) ?? -1)) cap = i; });
        const want = ids.map((pid, i) => ({ participant_id: pid, rol: i === cap ? "căpitan" : "jucător" }));
        const curSide = (roster.get(m.id) ?? []).filter(x => x.echipa_id === tid);
        const baza = m.sync_baza?.lot?.[tid] as string[] | undefined;
        const untouched = !baza || JSON.stringify(sideKey(curSide)) === JSON.stringify([...baza].sort());
        const differs = JSON.stringify(sideKey(curSide)) !== JSON.stringify(sideKey(want));
        // the other team must not already list one of these players in the same match
        const clash = (roster.get(m.id) ?? []).filter(x => x.echipa_id !== tid && ids.includes(x.participant_id));
        if (!differs) {
          if (!baza && !dry && !String(m.id).startsWith("nou-") && !isLocked(m.data)) {
            const nb = { ...(m.sync_baza ?? {}), lot: { ...(m.sync_baza?.lot ?? {}), [tid]: sideKey(want) } };
            await db.from("meciuri").update({ sync_baza: nb }).eq("id", m.id); m.sync_baza = nb;
          }
          continue;
        }
        if (!untouched) { note("conflicte", { tip: "lot", nr: m.nr, echipa: label, aplicatie: curSide.map(x => playerName(x.participant_id)), tabel: ids.map(playerName) }); continue; }
        if (isLocked(m.data)) { note("blocate", { nr: m.nr, data: m.data, motiv: `lotul ${label} diferă în tabel` }); continue; }
        if (clash.length) { note("erori", `#${m.nr}: ${clash.map(x => playerName(x.participant_id)).join(", ")} apare la ambele echipe`); continue; }
        note("schimbari", { nr: m.nr, lot: label, inainte: curSide.map(x => playerName(x.participant_id)), dupa: want.map(x => playerName(x.participant_id) + (x.rol === "căpitan" ? " (C)" : "")) });
        if (!dry && !String(m.id).startsWith("nou-")) {
          const del = await db.from("meci_jucatori").delete().eq("meci_id", m.id).eq("echipa_id", tid);
          if (del.error) { note("erori", `#${m.nr} ${label}: ${del.error.message}`); continue; }
          const ins = await db.from("meci_jucatori").insert(want.map(x => ({ meci_id: m.id, echipa_id: tid, participant_id: x.participant_id, rol: x.rol })));
          if (ins.error) {   // put the old side back rather than leave the match half-empty
            if (curSide.length) await db.from("meci_jucatori").insert(curSide.map(x => ({ meci_id: m.id, echipa_id: tid, participant_id: x.participant_id, rol: x.rol })));
            note("erori", `#${m.nr} ${label}: ${ins.error.message}`); continue;
          }
          roster.set(m.id, [...(roster.get(m.id) ?? []).filter(x => x.echipa_id !== tid), ...want.map(x => ({ ...x, echipa_id: tid }))]);
          const nb = { ...(m.sync_baza ?? {}), lot: { ...(m.sync_baza?.lot ?? {}), [tid]: sideKey(want) } };
          await db.from("meciuri").update({ sync_baza: nb, tabel_actualizat_la: stamp }).eq("id", m.id); m.sync_baza = nb;
        }
      }
    }

    raport.echipe_necunoscute = [...new Set(raport.echipe_necunoscute as string[])];
    stats.ok = (raport.erori as unknown[]).length === 0;
    const detalii = { ...raport, dryRun: dry };
    if (!dry) await db.from("sync_rezultate").insert({ ...stats, sursa: "tabel", detalii, eroare: stats.ok ? null : `${(raport.erori as unknown[]).length} erori` });
    return json({ ...stats, dryRun: dry, ...raport });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!dry) await db.from("sync_rezultate").insert({ ...stats, ok: false, sursa: "tabel", eroare: msg, detalii: raport });
    return json({ ...stats, error: msg, ...raport }, 500);
  }
});
