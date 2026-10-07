// BSKT Pontaj — PIN login for the shared on-site tablet account.
// Flow: IP rate limit → trusted IP → bcrypt PIN (verify_locatie_pin, service_role only) → magic-link session.
// The internal location user is provisioned on first successful login.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const LOCATION_EMAIL = "locatie@bskt-pontaj.internal";
const MAX_ATTEMPTS = 5;
const BLOCK_MINUTES = 15;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || "unknown";
}

// deno-lint-ignore no-explicit-any
async function ensureLocationUser(admin: any): Promise<boolean> {
  const { data: existing } = await admin.from("administratori").select("id").eq("rol", "locatie").limit(1).maybeSingle();
  if (existing) return true;
  const { data: created, error } = await admin.auth.admin.createUser({ email: LOCATION_EMAIL, email_confirm: true });
  let userId = created?.user?.id;
  if (error || !userId) {
    // user may exist in auth without an administratori row
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    userId = list?.users?.find((u: { email?: string }) => u.email === LOCATION_EMAIL)?.id;
    if (!userId) return false;
  }
  const { error: rowErr } = await admin.from("administratori")
    .upsert({ id: userId, nume: "Locație", prenume: "BSKT", rol: "locatie", ascuns: false });
  return !rowErr;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const ip = getClientIp(req);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request", ip }, 400);
  }
  const pin = String(body?.pin ?? "").trim();
  if (!pin) return json({ error: "missing_pin", ip }, 400);

  const { data: attempt } = await admin.from("locatie_login_attempts").select("*").eq("ip", ip).maybeSingle();
  const now = new Date();
  if (attempt?.blocat_pana && new Date(attempt.blocat_pana as string) > now) {
    return json({ error: "rate_limited", ip }, 429);
  }

  const { data: trusted } = await admin.from("trusted_ips").select("ip").eq("ip", ip).maybeSingle();
  if (!trusted) return json({ error: "ip_not_trusted", ip }, 403);

  const { data: pinOk, error: pinErr } = await admin.rpc("verify_locatie_pin", { incercare: pin });
  if (pinErr) return json({ error: "server_error", ip }, 500);

  if (!pinOk) {
    const failCount = ((attempt?.esuate as number) ?? 0) + 1;
    const blocked = failCount >= MAX_ATTEMPTS;
    await admin.from("locatie_login_attempts").upsert({
      ip,
      esuate: blocked ? 0 : failCount,
      blocat_pana: blocked ? new Date(now.getTime() + BLOCK_MINUTES * 60000).toISOString() : null,
      updated_at: now.toISOString(),
    });
    return json({ error: "wrong_pin", ip }, 401);
  }

  await admin.from("locatie_login_attempts").upsert({ ip, esuate: 0, blocat_pana: null, updated_at: now.toISOString() });

  if (!(await ensureLocationUser(admin))) return json({ error: "server_error", ip }, 500);

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: LOCATION_EMAIL });
  if (linkErr || !linkData?.properties?.hashed_token) return json({ error: "server_error", ip }, 500);

  const anon = createClient(SUPABASE_URL, ANON_KEY);
  const { data: sessionData, error: sessionErr } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (sessionErr || !sessionData.session) return json({ error: "server_error", ip }, 500);

  return json({
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
  });
});
