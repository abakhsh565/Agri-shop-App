// Supabase Edge Function: farmer-media
//
// WHAT IT IS. The one door to a conversation's files. A farmer has no JWT (his credential is the
// token the join code minted), so storage RLS cannot scope him; and a shared bucket policy for
// signed-in users would let any shop read any other shop's audio. So the bucket stays private and
// every read and write passes through here, where the participant is decided once, in SQL.
//
// WHO MAY DO WHAT
//   · POST (upload) — farmer: `x-farmer-token`. dealer: `Authorization: Bearer <supabase jwt>`.
//     The folder is DERIVED here (`<shop_id>/<farmer_id>/<uuid>.<ext>`), never taken from the
//     caller, so an upload cannot be aimed at another conversation.
//   · GET (link)    — same two credentials. It asks `farmer_media_attachment` whether THIS caller
//     may see THIS message, then mints a 60-second signed URL. Nothing is cached, nothing is
//     public, and the URL cannot be reused after it expires.
//
// CONTRACT (shared with the farmer app; see docs/FARMER_MEDIA_CONTRACT.md)
//   POST /functions/v1/farmer-media?kind=voice&mime=audio/webm&duration_ms=4200
//        headers: x-farmer-token: <token>            (farmer)
//                 Authorization: Bearer <jwt>        (dealer)
//        body:    raw bytes (audio/* or image/*)
//        200 { storage_path, content_type, size_bytes }
//        400 VALIDATION · 401 NOT_AUTHORIZED · 403 NOT_LINKED · 413 TOO_LARGE
//   GET  /functions/v1/farmer-media?message_id=<uuid>
//        headers: either credential
//        200 { message_id, kind, mime_type, duration_ms, sender, created_at, url, expires_in }
//        401 NOT_AUTHORIZED · 404 NOT_FOUND
//
// DEPLOY. `supabase functions deploy farmer-media --no-verify-jwt` (the function verifies the
// farmer token itself, and a dealer's JWT is verified with the platform's auth API below).
//
// SECRETS. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by the platform. No new secret.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "farmer-chat-media";
const MAX_BYTES = 10 * 1024 * 1024;
const SIGNED_URL_SECONDS = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-farmer-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** The caller's dealer identity, or null. A JWT is verified by the auth API, never by decoding it. */
async function dealerIdentity(req: Request, admin: ReturnType<typeof createClient>) {
  const header = req.headers.get("Authorization") ?? "";
  const jwt = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!jwt) return null;
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) return null;
  // The user id is all this function asserts. WHICH shop, and whether that shop links the farmer,
  // is a membership question and is answered by `farmer_media_upload_target` in SQL — the service
  // role has no grant on the link table, and it should not: one authority for one rule.
  return { userId: data.user.id as string };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const url = new URL(req.url);
  const farmerToken = (req.headers.get("x-farmer-token") ?? "").trim();
  const dealer = await dealerIdentity(req, admin);

  if (!farmerToken && !dealer) {
    return json({ error: "NOT_AUTHORIZED", message: "a farmer token or a signed-in dealer is required" }, 401);
  }

  // ── Upload ────────────────────────────────────────────────────────────────────────────────
  if (req.method === "POST") {
    const kind = (url.searchParams.get("kind") ?? "").trim().toLowerCase();
    const mime = (url.searchParams.get("mime") ?? "").trim().toLowerCase();
    const durationRaw = url.searchParams.get("duration_ms");
    const duration = durationRaw === null ? null : Number(durationRaw);

    if (kind !== "voice" && kind !== "image") {
      return json({ error: "VALIDATION", message: "kind must be voice or image" }, 400);
    }
    const ext = EXT[mime];
    if (!ext) {
      return json({ error: "VALIDATION", message: `unsupported mime type ${mime || "(none)"}` }, 400);
    }
    if (kind === "image" && !mime.startsWith("image/")) {
      return json({ error: "VALIDATION", message: "an image needs an image mime type" }, 400);
    }
    if (kind === "voice" && !mime.startsWith("audio/")) {
      return json({ error: "VALIDATION", message: "a voice note needs an audio mime type" }, 400);
    }
    if (kind === "voice" && (!Number.isFinite(duration!) || (duration as number) < 1 || (duration as number) > 600000)) {
      return json({ error: "VALIDATION", message: "a voice note needs duration_ms between 1 and 600000" }, 400);
    }

    let folder: string;
    let farmerId: string;
    if (farmerToken) {
      const { data, error } = await admin.rpc("farmer_media_identity", { p_token: farmerToken });
      if (error || !data) {
        return json({ error: "NOT_AUTHORIZED", message: "that farmer token is not valid" }, 401);
      }
      folder = `${data.shop_id}/${data.farmer_id}`;
      farmerId = data.farmer_id as string;
    } else {
      const requestedFarmer = (url.searchParams.get("farmer_id") ?? "").trim();
      if (!requestedFarmer) return json({ error: "VALIDATION", message: "farmer_id is required for a dealer upload" }, 400);
      // The folder comes from the database's answer, never from the request: it is one of THIS
      // dealer's shops AND a shop that really links this farmer.
      const { data: target, error: targetError } = await admin.rpc("farmer_media_upload_target", {
        p_user_id: dealer!.userId,
        p_farmer_id: requestedFarmer,
      });
      if (targetError) {
        const refused = /NOT_LINKED/.test(targetError.message);
        return json(
          {
            error: refused ? "NOT_LINKED" : "NOT_AUTHORIZED",
            message: refused ? "that farmer is not linked to this shop" : "no active shop for this session",
          },
          refused ? 403 : 401,
        );
      }
      folder = `${(target as { shop_id: string }).shop_id}/${requestedFarmer}`;
      farmerId = requestedFarmer;
    }

    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) return json({ error: "TOO_LARGE", message: "10 MB maximum" }, 413);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength === 0) return json({ error: "VALIDATION", message: "empty upload" }, 400);
    if (bytes.byteLength > MAX_BYTES) return json({ error: "TOO_LARGE", message: "10 MB maximum" }, 413);

    const storagePath = `${folder}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, bytes, { contentType: mime, upsert: false, cacheControl: "private, max-age=0" });
    if (uploadError) {
      return json({ error: "STORAGE_FAILED", message: uploadError.message }, 500);
    }

    return json({
      storage_path: storagePath,
      content_type: mime,
      size_bytes: bytes.byteLength,
      farmer_id: farmerId,
      duration_ms: kind === "voice" ? Math.round(duration as number) : null,
    });
  }

  // ── Signed link ───────────────────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const messageId = (url.searchParams.get("message_id") ?? "").trim();
    if (!messageId) return json({ error: "VALIDATION", message: "message_id is required" }, 400);

    const { data, error } = await admin.rpc("farmer_media_attachment", {
      p_message_id: messageId,
      p_farmer_token: farmerToken || null,
      p_user_id: dealer?.userId ?? null,
    });
    if (error) {
      // The SQL refuses with NOT_FOUND for "not yours" as well as "not there": a caller must not be
      // able to tell a missing message from somebody else's.
      const refused = /NOT_AUTHORIZED/.test(error.message);
      return json({ error: refused ? "NOT_AUTHORIZED" : "NOT_FOUND", message: error.message }, refused ? 401 : 404);
    }

    const { data: signed, error: signError } = await admin.storage
      .from(data.storage_bucket ?? BUCKET)
      .createSignedUrl(data.storage_path, SIGNED_URL_SECONDS);
    if (signError || !signed?.signedUrl) {
      return json({ error: "SIGN_FAILED", message: signError?.message ?? "no url" }, 500);
    }

    return json({
      message_id: data.message_id,
      kind: data.kind,
      mime_type: data.mime_type,
      size_bytes: data.size_bytes,
      duration_ms: data.duration_ms,
      sender: data.sender,
      created_at: data.created_at,
      url: signed.signedUrl,
      expires_in: SIGNED_URL_SECONDS,
    });
  }

  return json({ error: "METHOD_NOT_ALLOWED" }, 405);
});
