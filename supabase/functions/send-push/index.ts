// Supabase Edge Function: send-push
//
// WHAT IT IS. The only place this product talks to Firebase. It claims unsent rows from
// `public.push_deliveries`, resolves every live device of the recipient, sends one FCM v1
// message per device, and records the outcome. Everything that decides *what* to notify lives in
// the database (migration 0329); this function only decides *how it travels*.
//
// WHY A QUEUE AND NOT AN HTTP CALL FROM A TRIGGER. A business write must never fail because
// Google was slow, and a retry must not write the sale twice. The trigger writes a row in the
// same transaction as the event; this function may run late, twice, or not at all without
// changing what happened.
//
// SECRETS (set with `supabase secrets set`, never in the repo):
//   FCM_SERVICE_ACCOUNT_OWNER   service-account JSON of the Firebase project that owns the
//                               shop app's `google-services.json`
//   FCM_SERVICE_ACCOUNT_FARMER  service-account JSON of the farmer app's Firebase project
//   FCM_SERVICE_ACCOUNT         fallback for both, when the two apps share one project
//   PUSH_DISPATCH_SECRET        a random string the caller must send in `x-push-secret`
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
//
// WHY TWO KEYS. An FCM token is only addressable by the project that minted it: a key from
// project A receives 404/UNREGISTERED for a token from project B, which looks exactly like an
// uninstalled app. The shop app and the farmer app are separate Android apps and may live in
// separate Firebase projects, so the sender picks the key by recipient — never one key for both.
//
// DRY RUN. POST { "dryRun": true } returns the first 20 messages it *would* send, without
// calling FCM and without marking anything. This is how the pipeline is tested before a real
// Firebase key exists.
//
// DEPLOY. `supabase functions deploy send-push --no-verify-jwt`, then schedule it (pg_cron or
// the dashboard) to run every minute. It is idempotent: rows already stamped `sent_at` are
// skipped, and a device rejected by FCM is revoked instead of retried forever.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-push-secret",
};

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

interface Delivery {
  id: string;
  user_id: string | null;
  farmer_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  attempts: number;
}

interface Device {
  token: string;
  platform: string;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function base64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The service account's RSA key as a CryptoKey. PEM is PKCS#8, which is what FCM's key is. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey(
    "pkcs8",
    bytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * An OAuth access token for FCM, signed with the service account.
 *
 * The JWT is built and signed here rather than with a library: this runs in Deno with Web Crypto
 * already present, and one fewer dependency in the sender is one fewer thing that can be
 * supply-chained into a token that can message every install of the app.
 */
async function accessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: FCM_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const key = await importPrivateKey(account.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${base64url(new Uint8Array(signature))}`,
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error(`FCM auth failed: ${payload.error_description ?? payload.error ?? response.status}`);
  }
  return payload.access_token as string;
}

function androidNotification(body: string | null) {
  return {
    channel_id: "agrishop",
    // The body is already capped at 300 characters by the table; FCM truncates longer text
    // silently, and a cut-off sentence is worse than a short one.
    ...(body ? { body } : {}),
    icon: "ic_stat_agrishop",
    color: "#1F7A4D",
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const expected = Deno.env.get("PUSH_DISPATCH_SECRET") ?? "";
  if (expected && req.headers.get("x-push-secret") !== expected) {
    return json({ error: "NOT_AUTHORIZED" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let dryRun = false;
  try {
    const payload = await req.json();
    dryRun = payload?.dryRun === true;
  } catch {
    // No body is the normal cron call.
  }

  try {
    const { data: deliveries, error } = await supabase
      .from("push_deliveries")
      .select("id,user_id,farmer_id,kind,title,body,data,attempts")
      .is("sent_at", null)
      .lt("attempts", 5)
      .order("created_at", { ascending: true })
      .limit(50);

    if (error) throw new Error(`queue read failed: ${error.message}`);
    const rows = (deliveries ?? []) as Delivery[];
    if (rows.length === 0) return json({ queued: 0, sent: 0, skipped: 0 });

    // One message per device, not per delivery: two events for the same person must not be
    // collapsed into one notification, but the device lookup is shared.
    const byRecipient = new Map<string, Delivery[]>();
    for (const row of rows) {
      const key = row.user_id ? `user:${row.user_id}` : `farmer:${row.farmer_id}`;
      const list = byRecipient.get(key) ?? [];
      list.push(row);
      byRecipient.set(key, list);
    }

    const plans: Array<{ delivery: Delivery; devices: Device[] }> = [];
    for (const list of byRecipient.values()) {
      const first = list[0];
      const { data: devices } = await supabase
        .from("push_devices")
        .select("token,platform")
        .eq(first.user_id ? "user_id" : "farmer_id", first.user_id ?? first.farmer_id)
        .is("revoked_at", null);
      for (const delivery of list) plans.push({ delivery, devices: (devices ?? []) as Device[] });
    }

    if (dryRun) {
      return json({
        dryRun: true,
        queued: rows.length,
        preview: plans.slice(0, 20).map((plan) => ({
          id: plan.delivery.id,
          to: plan.delivery.user_id ? `user:${plan.delivery.user_id}` : `farmer:${plan.delivery.farmer_id}`,
          kind: plan.delivery.kind,
          title: plan.delivery.title,
          body: plan.delivery.body,
          devices: plan.devices.length,
        })),
      });
    }

    // One access token per Firebase project, minted lazily: a run that only carries farmer
    // events must not need the shop app's key at all.
    const senders = new Map<string, { account: ServiceAccount; token: string }>();
    const senderFor = async (recipient: "owner" | "farmer") => {
      const raw =
        (recipient === "farmer"
          ? Deno.env.get("FCM_SERVICE_ACCOUNT_FARMER")
          : Deno.env.get("FCM_SERVICE_ACCOUNT_OWNER")) ?? Deno.env.get("FCM_SERVICE_ACCOUNT");
      if (!raw) return null;
      const account = JSON.parse(raw) as ServiceAccount;
      const existing = senders.get(account.project_id);
      if (existing) return existing;
      const sender = { account, token: await accessToken(account) };
      senders.set(account.project_id, sender);
      return sender;
    };

    if (!Deno.env.get("FCM_SERVICE_ACCOUNT") && !Deno.env.get("FCM_SERVICE_ACCOUNT_OWNER") && !Deno.env.get("FCM_SERVICE_ACCOUNT_FARMER")) {
      return json(
        {
          error: "no Firebase sender configured",
          queued: rows.length,
          hint: "Set FCM_SERVICE_ACCOUNT_OWNER and FCM_SERVICE_ACCOUNT_FARMER (or FCM_SERVICE_ACCOUNT). Nothing was marked sent.",
        },
        503,
      );
    }

    let sent = 0;
    let skipped = 0;
    const failures: Array<{ id: string; error: string }> = [];

    for (const plan of plans) {
      const { delivery, devices } = plan;
      if (devices.length === 0) {
        // No phone registered: the in-app notification is still there. Mark it done so the
        // queue does not accumulate rows nobody can ever receive.
        await supabase
          .from("push_deliveries")
          .update({ sent_at: new Date().toISOString(), last_error: "no device" })
          .eq("id", delivery.id);
        skipped += 1;
        continue;
      }

      const sender = await senderFor(delivery.farmer_id ? "farmer" : "owner");
      if (!sender) {
        // The recipient's app lives in a Firebase project this deployment has no key for.
        // Recording it as a failure is honest: it is not delivered, and it is not retried
        // into a void forever (attempts stops at 5).
        await supabase
          .from("push_deliveries")
          .update({
            attempts: delivery.attempts + 1,
            last_error: `no Firebase key for ${delivery.farmer_id ? "farmer" : "owner"} app project`,
          })
          .eq("id", delivery.id);
        failures.push({ id: delivery.id, error: "no Firebase key for this app" });
        continue;
      }

      let delivered = false;
      let lastError = "";

      for (const device of devices) {
        const message = {
          message: {
            token: device.token,
            notification: {
              title: delivery.title,
              ...(delivery.body ? { body: delivery.body } : {}),
            },
            data: Object.fromEntries(
              Object.entries(delivery.data ?? {}).map(([key, value]) => [key, String(value)]),
            ),
            android: {
              priority: "high",
              notification: androidNotification(delivery.body),
            },
          },
        };

        const response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${sender.account.project_id}/messages:send`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${sender.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(message),
          },
        );

        if (response.ok) {
          delivered = true;
          continue;
        }

        const detail = await response.text();
        lastError = `${response.status}: ${detail.slice(0, 300)}`;

        // A token that is gone is not a transient failure. Revoke it, so the next event does not
        // spend a request on a phone that was uninstalled.
        if (response.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(detail)) {
          await supabase
            .from("push_devices")
            .update({ revoked_at: new Date().toISOString() })
            .eq("token", device.token);
        }
      }

      if (delivered) {
        await supabase
          .from("push_deliveries")
          .update({ sent_at: new Date().toISOString(), last_error: null })
          .eq("id", delivery.id);
        sent += 1;
      } else {
        await supabase
          .from("push_deliveries")
          .update({
            attempts: delivery.attempts + 1,
            last_error: lastError || "no device accepted the message",
          })
          .eq("id", delivery.id);
        failures.push({ id: delivery.id, error: lastError });
      }
    }

    return json({ queued: rows.length, sent, skipped, failures });
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
});
