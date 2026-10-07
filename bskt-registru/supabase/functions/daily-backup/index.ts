// BSKT Pontaj — nightly JSON backup e-mailed via Resend.
// Secrets live in Vault (read through get_secret, service_role only):
//   cron_secret   — must match the x-cron-secret header sent by pg_cron
//   resend_api_key, backup_email — set these to enable the e-mail
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BACKUP_EMAIL_FROM = "BSKT Pontaj <onboarding@resend.dev>";

const TABLES = [
  "administratori", "serviciu_administratori", "echipe", "participanti", "arbitri", "meciuri", "meci_jucatori",
  "tarife_plata", "intarzieri", "vestimentatie", "serviciu", "spalatorie", "hostel", "lenjerie", "daune",
  "arbitraj", "fair_play", "inventar", "inventar_miscari", "sarcini", "sarcini_istoric_status", "observatii",
  "pauze_tehnice", "treninguri", "sesiuni_schimb", "acte_schimb", "jurnal", "trusted_ips",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

Deno.serve(async (req) => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const secret = async (name: string) => (await admin.rpc("get_secret", { p_name: name })).data as string | null;

  const cronSecret = await secret("cron_secret");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) return json({ error: "unauthorized" }, 401);

  const [resendKey, emailTo] = await Promise.all([secret("resend_api_key"), secret("backup_email")]);
  if (!resendKey || !emailTo) return json({ error: "backup_not_configured" }, 500);

  const today = new Date().toISOString().slice(0, 10);
  const dump: Record<string, unknown> = { generated_at: new Date().toISOString(), project: "bskt-pontaj" };
  let totalRows = 0;
  const errors: string[] = [];

  for (const table of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from(table).select("*").range(from, from + 999);
      if (error) { errors.push(`${table}: ${error.message}`); break; }
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    dump[table] = rows;
    totalRows += rows.length;
  }

  const jsonStr = JSON.stringify(dump, null, 2);
  const sizeKb = Math.round(jsonStr.length / 1024);

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: BACKUP_EMAIL_FROM,
      to: [emailTo],
      subject: `Backup BSKT Pontaj — ${today}`,
      html: `<p>Backup automat zilnic pentru registrul BSKT Pontaj.</p>` +
        `<p>Data: <b>${today}</b><br>Total înregistrări: <b>${totalRows}</b><br>Mărime fișier: ~${sizeKb} KB</p>` +
        (errors.length ? `<p style="color:#b00">Erori la unele tabele:<br>${errors.join("<br>")}</p>` : ""),
      attachments: [{ filename: `bskt-backup-${today}.json`, content: toBase64(jsonStr) }],
    }),
  });

  const emailResult = await emailRes.json().catch(() => ({}));
  if (!emailRes.ok) return json({ error: "resend_failed", status: emailRes.status, detail: emailResult }, 500);
  return json({ ok: true, totalRows, sizeKb, tableErrors: errors, emailId: emailResult?.id });
});
