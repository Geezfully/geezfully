// BSKT Registru — one-time sign-up links (see migration 20261008210000_invitatii).
// POST {action:'check', token}                          → { ok, rol, limba, expira_la } | { error }
// POST {action:'accept', token, email, password, nume}  → { ok, email } | { error }
// The token is 48 hex chars; only its SHA-256 is stored. Accepting claims the invitation atomically first,
// then allow-lists the e-mail, creates a confirmed auth user and the administratori row; any failure undoes the claim.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}
async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const token = String(body?.token ?? "");
  if (!/^[0-9a-f]{48}$/.test(token)) return json({ error: "invalid" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: inv } = await admin.from("invitatii")
    .select("id,rol,limba,expira_la,folosita_la,anulata_la").eq("token_hash", await sha256Hex(token)).maybeSingle();
  if (!inv) return json({ error: "invalid" }, 404);
  if (inv.folosita_la) return json({ error: "used" }, 410);
  if (inv.anulata_la) return json({ error: "cancelled" }, 410);
  if (new Date(inv.expira_la as string) <= new Date()) return json({ error: "expired" }, 410);

  if (body?.action === "check") return json({ ok: true, rol: inv.rol, limba: inv.limba, expira_la: inv.expira_la });
  if (body?.action !== "accept") return json({ error: "bad_request" }, 400);

  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const nume = String(body?.nume ?? "").replace(/\s+/g, " ").trim();
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "bad_email" }, 400);
  if (password.length < 8 || password.length > 72) return json({ error: "bad_password" }, 400);
  if (nume.length < 2 || nume.length > 60) return json({ error: "bad_name" }, 400);

  // 1. claim the invitation (only one request can win)
  const nowIso = new Date().toISOString();
  const { data: claimed } = await admin.from("invitatii")
    .update({ folosita_la: nowIso, email, nume_afisat: nume })
    .eq("id", inv.id).is("folosita_la", null).is("anulata_la", null).gt("expira_la", nowIso).select("id");
  if (!claimed?.length) return json({ error: "used" }, 410);
  const release = () => admin.from("invitatii").update({ folosita_la: null, email: null, nume_afisat: null }).eq("id", inv.id);

  // 2. allow-list the e-mail (the auth.users trigger refuses anything else)
  const { data: already } = await admin.from("conturi_permise").select("email").eq("email", email).maybeSingle();
  if (!already) {
    const { error } = await admin.from("conturi_permise").insert({ email, observatie: `invitație ${inv.rol}` });
    if (error) { await release(); return json({ error: "server_error" }, 500); }
  }
  const unlist = async () => { if (!already) await admin.from("conturi_permise").delete().eq("email", email); };

  // 3. confirmed auth user with the chosen password
  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const userId = created?.user?.id;
  if (cErr || !userId) {
    await unlist(); await release();
    const exists = /already|registered|exists/i.test(cErr?.message ?? "");
    const weak = /password/i.test(cErr?.message ?? "");
    return json({ error: exists ? "email_exists" : weak ? "bad_password" : "server_error" }, exists ? 409 : 400);
  }

  // 4. registry profile with the invited role
  const { error: pErr } = await admin.from("administratori").insert({ id: userId, nume, prenume: "", rol: inv.rol, ascuns: false });
  if (pErr) {
    await admin.auth.admin.deleteUser(userId); await unlist(); await release();
    return json({ error: "server_error" }, 500);
  }
  await admin.from("invitatii").update({ cont_id: userId }).eq("id", inv.id);
  await admin.from("jurnal").insert({ administrator_id: userId,
    actiune: `${nume} s-a înregistrat prin invitație (${inv.rol === "admin" ? "administrator" : "asistent"})` });
  return json({ ok: true, email });
});
