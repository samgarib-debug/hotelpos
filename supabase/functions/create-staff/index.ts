// create-staff — staff account lifecycle without email addresses.
//
// Staff accounts are created by a signed-in manager/admin from the Staff
// screen. GoTrue still needs an email-shaped identity, so accounts are
// created as `<username>@hotelpos.invalid` (.invalid is RFC-reserved and can
// never receive mail) with email_confirm=true — which is also what lets them
// pass the DB-level self-signup block (0010: unconfirmed inserts are refused).
//
// Actions (POST, JSON body):
//   { action: "create", username, password, full_name? }
//       caller: manager or admin (active). New accounts always start as
//       role 'staff' — promotions stay admin-only via the existing UI/RLS.
//   { action: "set-password", user_id, password }
//       caller: admin (targets staff/manager) or manager (targets staff).
//       Never admins, never yourself (use "Change my password" in-app).
//
// Auth: the caller's JWT is validated server-side via auth.getUser(); the
// anon key alone is rejected there. Role/deactivation come from profiles
// using the service client (never from claims the client controls).

import { createClient } from "npm:@supabase/supabase-js@2";

const STAFF_DOMAIN = "hotelpos.invalid";
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const MIN_PASSWORD = 8;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Identify + authorize the caller
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json(401, { error: "Sign in required" });
  const callerId = userData.user.id;

  const { data: caller, error: callerErr } = await admin
    .from("profiles")
    .select("role, deactivated")
    .eq("id", callerId)
    .maybeSingle();
  if (callerErr) return json(500, { error: "Could not load your profile" });
  if (!caller || caller.deactivated || !["manager", "admin"].includes(caller.role)) {
    return json(403, { error: "Adding staff needs a manager or admin" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid request body" });
  }
  const action = typeof body.action === "string" ? body.action : "create";
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < MIN_PASSWORD) {
    return json(400, { error: `Password must be at least ${MIN_PASSWORD} characters` });
  }

  if (action === "set-password") {
    const targetId = typeof body.user_id === "string" ? body.user_id : "";
    if (!targetId) return json(400, { error: "user_id required" });
    if (targetId === callerId) {
      return json(400, { error: "Use “Change my password” for your own account" });
    }
    const { data: target, error: targetErr } = await admin
      .from("profiles")
      .select("role, username")
      .eq("id", targetId)
      .maybeSingle();
    if (targetErr || !target) return json(404, { error: "Staff member not found" });
    const allowed =
      caller.role === "admin"
        ? ["staff", "manager"].includes(target.role)
        : target.role === "staff";
    if (!allowed) {
      return json(403, {
        error:
          target.role === "admin"
            ? "Admin passwords cannot be reset in-app"
            : "Resetting a manager password needs an admin",
      });
    }
    const { error: updErr } = await admin.auth.admin.updateUserById(targetId, {
      password,
    });
    if (updErr) return json(500, { error: updErr.message });
    return json(200, { ok: true, username: target.username });
  }

  if (action !== "create") return json(400, { error: "Unknown action" });

  const username =
    typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const fullName =
    typeof body.full_name === "string" && body.full_name.trim() !== ""
      ? body.full_name.trim()
      : username;
  if (!USERNAME_RE.test(username)) {
    return json(400, {
      error:
        "Username must be 1–32 characters: lowercase letters, digits, dots, dashes or underscores, starting with a letter or digit",
    });
  }

  // Friendly pre-check; the unique index still backstops races.
  // (usernames are stored lowercase, so plain equality is the right match)
  const { data: existing, error: existErr } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (existErr) return json(500, { error: "Could not check the username" });
  if (existing) return json(409, { error: "That username is already taken" });

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: `${username}@${STAFF_DOMAIN}`,
    password,
    email_confirm: true,
    user_metadata: { username, full_name: fullName },
    // app_metadata is admin-API-only (public /signup can't set it), so the
    // DB self-signup block (migration 0012) trusts this marker to admit the
    // admin.createUser insert, which arrives unconfirmed-then-confirmed.
    app_metadata: { hotelpos_admin_created: true },
  });
  if (createErr) {
    const msg = /already|duplicate|unique/i.test(createErr.message)
      ? "That username is already taken"
      : createErr.message;
    return json(400, { error: msg });
  }

  return json(200, {
    ok: true,
    id: created.user?.id,
    username,
    full_name: fullName,
    role: "staff",
  });
});
