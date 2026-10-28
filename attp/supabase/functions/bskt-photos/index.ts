// Copies the basketball players' photos (from the BSKT register's short-lived links) into our public bucket,
// so the site never depends on the register. Called only by public.sync_bskt() with x-sync-key, which must
// match the vault secret 'bskt_export_key' (checked by bskt_sync_key_ok()).
// Body: { copiaza: [{id, versiune, url}], sterge: [id] } → { copiate: [{id, versiune, url, url_mic}], esuate: [...] }
// It does not write to the database itself: the calling sync transaction holds those rows and records the result.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

const BUCKET = "player-photos";
const DIR = "bskt";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const safe = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

async function removeFor(id: string, keepPrefix?: string) {
  const { data } = await db.storage.from(BUCKET).list(DIR, { search: id, limit: 100 });
  const stale = (data ?? []).map(f => f.name).filter(n => n.startsWith(id) && (!keepPrefix || !n.startsWith(keepPrefix)));
  if (stale.length) await db.storage.from(BUCKET).remove(stale.map(n => `${DIR}/${n}`));
}

Deno.serve(async (req) => {
  const { data: ok } = await db.rpc("bskt_sync_key_ok", { p_key: req.headers.get("x-sync-key") ?? "" });
  if (!ok) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const copiate: unknown[] = [], esuate: unknown[] = [];

  for (const id of (body.sterge ?? []) as string[]) if (safe(id)) await removeFor(id);

  for (const item of (body.copiaza ?? []) as { id: string; versiune: string; url: string }[]) {
    try {
      if (!safe(item.id)) throw new Error("bad id");
      const res = await fetch(item.url);
      if (!res.ok) throw new Error(`download ${res.status}`);
      const src = await Image.decode(new Uint8Array(await res.arrayBuffer()));
      // portrait source (31:39): square crop from slightly below the top, so the head stays in frame
      const side = Math.min(src.width, src.height);
      const top = Math.round(Math.max(0, src.height - side) * 0.18);
      const square = src.clone().crop(Math.round((src.width - side) / 2), top, side, side);
      const stem = `${item.id}-${String(item.versiune).replace(/[^0-9A-Za-z]/g, "").slice(0, 20)}`;
      const urls: Record<number, string> = {};
      for (const size of [400, 180]) {
        const bytes = await square.clone().resize(size, size).encodeJPEG(size >= 400 ? 82 : 80);
        const path = `${DIR}/${stem}-${size}.jpg`;
        const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: "image/jpeg", cacheControl: "31536000", upsert: true });
        if (error) throw new Error(`upload ${size}: ${error.message}`);
        urls[size] = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      }
      await removeFor(item.id, stem);   // older versions of this player's photo
      copiate.push({ id: item.id, versiune: item.versiune, url: urls[400], url_mic: urls[180] });
    } catch (e) {
      esuate.push({ id: item.id, motiv: String((e as Error).message ?? e) });
    }
  }
  return json({ copiate, esuate });
});
