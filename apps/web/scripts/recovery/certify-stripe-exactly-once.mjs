import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const cloneRef = process.env.F0_CLONE_REF;
const stripeExe = process.env.F0_STRIPE_EXE;
if (!cloneRef || !stripeExe) throw new Error("F0_CLONE_REF and F0_STRIPE_EXE are required");

function run(file, args) {
  return execFileSync(file, args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}

function getCloneKeys() {
  const raw = run("cmd.exe", ["/d", "/s", "/c", `npx.cmd supabase projects api-keys --project-ref ${cloneRef} --output json`]);
  const keys = JSON.parse(raw);
  const admin = keys.find((key) => ["secret", "service_role"].includes(key.name));
  const publicKey = keys.find((key) => ["publishable", "anon"].includes(key.name));
  if (!admin?.api_key || !publicKey?.api_key) throw new Error("Clone API key classes are incomplete");
  return { admin: admin.api_key, public: publicKey.api_key };
}

function latestMatchingEvent(userId, createdAfter) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const raw = run(stripeExe, ["events", "list", "--type", "checkout.session.completed", "--limit", "10"]);
    const list = JSON.parse(raw);
    const event = list.data?.find((candidate) =>
      candidate.created >= createdAfter && candidate.data?.object?.metadata?.user_id === userId
    );
    if (event) return event;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error("Triggered Stripe event was not observable in the sandbox event log");
}

const keys = getCloneKeys();
const cloneUrl = `https://${cloneRef}.supabase.co`;
const admin = createClient(cloneUrl, keys.admin, { auth: { autoRefreshToken: false, persistSession: false } });
const canaryTag = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
const canaryEmail = `f0-stripe-${canaryTag}@example.invalid`;
const canaryPassword = crypto.randomBytes(32).toString("base64url");
let userId;
let eventId;
let nextProcess;

try {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: canaryEmail,
    password: canaryPassword,
    email_confirm: true,
    user_metadata: { purpose: "f0_stripe_exactly_once_canary" },
  });
  if (createError || !created.user?.id) throw createError || new Error("Disposable clone user was not created");
  userId = created.user.id;

  const { data: product, error: productError } = await admin.from("products").select("slug").limit(1).single();
  if (productError || !product?.slug) throw productError || new Error("No product is available for the canary");
  const slugs = JSON.stringify([product.slug]);
  const items = JSON.stringify([{ slug: product.slug, quantity: 1, type: "digital" }]);
  const createdAfter = Math.floor(Date.now() / 1000) - 2;

  run(stripeExe, [
    "trigger", "checkout.session.completed",
    "--override", `checkout_session:metadata[user_id]=${userId}`,
    "--override", `checkout_session:metadata[slugs]=${slugs}`,
    "--override", `checkout_session:metadata[items]=${items}`,
  ]);

  const event = latestMatchingEvent(userId, createdAfter);
  eventId = event.id;
  const payload = JSON.stringify(event);
  const webhookSecret = `whsec_${crypto.randomBytes(32).toString("hex")}`;

  const isolatedEnv = {
    SystemRoot: process.env.SystemRoot,
    ComSpec: process.env.ComSpec,
    PATH: process.env.PATH,
    PATHEXT: process.env.PATHEXT,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: cloneUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: keys.public,
    SUPABASE_SECRET_KEY: keys.admin,
    STRIPE_SECRET_KEY: "sk_test_f0_local_signature_only",
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    ACCOUNT_LIFECYCLE_EXECUTION_ENABLED: "false",
  };

  const port = 32000 + crypto.randomInt(1000);
  nextProcess = spawn("cmd.exe", ["/d", "/s", "/c", `npm.cmd run dev -- --port ${port}`], {
    windowsHide: true,
    stdio: "ignore",
    env: isolatedEnv,
  });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (nextProcess.exitCode !== null) throw new Error(`Isolated Next server exited with ${nextProcess.exitCode}`);
    try {
      const probe = await fetch(`http://127.0.0.1:${port}/api/webhook`);
      if (probe.status === 405) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Isolated Next server did not become ready");

  const deliver = async () => {
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const response = await fetch(`http://127.0.0.1:${port}/api/webhook`, {
      method: "POST",
      body: payload,
      headers: { "content-type": "application/json", "stripe-signature": signature },
    });
    return { status: response.status, body: await response.json() };
  };

  const first = await deliver();
  const second = await deliver();

  const [{ count: claims, error: claimError }, { count: purchases, error: purchaseError }, { count: library, error: libraryError }] = await Promise.all([
    admin.from("processed_stripe_events").select("event_id", { count: "exact", head: true }).eq("event_id", eventId),
    admin.from("purchases").select("id", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("library_items").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  if (claimError || purchaseError || libraryError) throw claimError || purchaseError || libraryError;

  const pass = first.status === 200 && second.status === 200 && second.body?.duplicate === true &&
    claims === 1 && purchases === 1 && library === 1;

  console.log(JSON.stringify({
    certification: "F0_STRIPE_EXACTLY_ONCE",
    stripeLivemode: event.livemode,
    eventType: event.type,
    firstStatus: first.status,
    secondStatus: second.status,
    duplicateAcknowledged: second.body?.duplicate === true,
    processedEventClaims: claims,
    purchases,
    libraryItems: library,
    result: pass ? "PASS" : "FAIL",
  }, null, 2));

  if (!pass) process.exitCode = 1;
} finally {
  if (nextProcess && nextProcess.exitCode === null) {
    try {
      execFileSync("taskkill.exe", ["/PID", String(nextProcess.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      nextProcess.kill();
    }
  }
  if (userId) {
    const { data: purchaseRows } = await admin.from("purchases").select("id").eq("user_id", userId);
    const purchaseIds = (purchaseRows || []).map((row) => row.id);
    if (purchaseIds.length) await admin.from("library_items").delete().in("purchase_id", purchaseIds);
    await admin.from("purchases").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
  if (eventId) await admin.from("processed_stripe_events").delete().eq("event_id", eventId);
}
