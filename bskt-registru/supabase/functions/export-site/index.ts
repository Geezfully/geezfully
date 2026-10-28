// BSKT Pontaj → ATTP website (geezfully.com/attp): read-only export of public basketball player profiles.
// Called by the ATTP project's sync on a schedule with header x-export-key; the key's SHA-256 must be in
// export_chei (not revoked). What is published is decided by the SQL function export_site_attp(): name, age,
// games/wins/losses and per-game date + score, never the team or any other personal field; photos only for
// players who gave consent, as short-lived signed links (the consumer copies the image to its own storage).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PHOTO_BUCKET = "fotografii";
const LINK_SECONDS = 3600;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const key = req.headers.get("x-export-key") ?? "";
  if (key.length < 32) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: k } = await admin.from("export_chei").select("id").eq("cheie_hash", await sha256Hex(key)).is("revocat_la", null).maybeSingle();
  if (!k) return json({ error: "unauthorized" }, 401);

  const { data, error } = await admin.rpc("export_site_attp");
  if (error) return json({ error: error.message }, 500);
  const players = (data?.jucatori ?? []) as Array<Record<string, unknown>>;

  // signed links for the allowed photos; `versiune` changes whenever the photo is replaced
  const paths = players.map(p => p.foto_path as string | null).filter((p): p is string => !!p);
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await admin.storage.from(PHOTO_BUCKET).createSignedUrls(paths, LINK_SECONDS);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  const jucatori = players.map(({ foto_path, ...p }) => {
    const path = foto_path as string | null;
    const url = path ? urls.get(path) : undefined;
    return { ...p, foto: path && url ? { versiune: path.split("/").pop(), url } : null };
  });

  return json({ generat_la: data?.generat_la, jucatori });
});
