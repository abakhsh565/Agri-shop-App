/**
 * handler.mjs — the assistant's one request path.
 *
 * It lives apart from `index.ts` for one reason: the app is worked on and proved on a machine
 * that cannot deploy edge functions on demand, and the half of this system that matters — who may
 * see what — must be exercised against the code that actually ships. So `index.ts` is a five-line
 * Deno wrapper around this, and `ai-assistant/server/dev.mjs` is a small Node wrapper around the
 * same function. There is no second implementation of the rules to drift.
 *
 * THE THREE THINGS THIS FILE IS RESPONSIBLE FOR
 *
 *   1. Using the caller's own token. Not a service key, not an "assistant account": every read
 *      below is a PostgREST call carrying the person's own session, so the database scopes it to
 *      their shop and their permissions decide what the tools are even asked about.
 *   2. Offering only the tools that account holds. The list is computed from the same
 *      `get_my_permissions()` the app's screens use.
 *   3. Keeping nothing. There is no store here, no table write, no log of the conversation: the
 *      transcript lives in the app's memory and comes back as context with the next question.
 */
import { makeClient, TOOLS_BY_NAME, toolsFor } from "./tools.mjs";
import { ask } from "./providers.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** The same shell prefixes the app's own routes use, so a card's screen name lands where the app lands. */
function shellFor(role, permissions, experience) {
  if (experience === "owner" || experience === "co_owner") return "admin";
  const ownerSide = role === "owner" || role === "admin" || permissions.includes("employees.manage");
  return ownerSide ? "admin" : "employee";
}

/**
 * Who the token belongs to — its `sub`, the same claim the database's own `app_current_user_id()`
 * reads. Decoded rather than trusted: nothing here authorises anything by itself, it only labels
 * the row read that follows, which the database scopes to the caller anyway.
 */
function jwtSubject(token) {
  try {
    const payload = token.split(".")[1] ?? "";
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).sub ?? null;
  } catch {
    return null;
  }
}

/** Trim the photo and refuse anything that is not an image, before it goes anywhere. */
function normalisePhoto(input) {
  const raw = String(input.data ?? "").replace(/^data:[^,]*,/, "");
  if (!raw) return null;
  if (raw.length > 8_000_000) throw new Error("That photo is too large. Try one under about 6 MB.");
  const mimeType = /^image\/(png|jpeg|jpg|webp|heic)$/i.test(String(input.mimeType ?? ""))
    ? String(input.mimeType)
    : "image/jpeg";
  return { data: raw, mimeType };
}

/**
 * Answer one request. `env` carries the Supabase URL, the anon key, and optionally a model key —
 * so the same function runs against a QA project from a laptop or against production on the edge.
 */
export async function handle(req, env) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = env.supabaseUrl ?? "";
  const anonKey = env.anonKey ?? "";
  const geminiKey = env.geminiKey ?? "";
  const geminiModel = env.geminiModel ?? "gemini-2.5-flash";
  const geminiFallbackModel = env.geminiFallbackModel ?? "";
  // Where the model calls go. Empty means Google. See providers.mjs: this is what lets the same
  // function be pointed at a gateway without a second call path.
  const modelBaseUrl = env.modelBaseUrl ?? "";

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Sign in first — the assistant runs as you." }, 401);

  const client = makeClient({ baseUrl: url, anonKey, accessToken: token });

  let permissions;
  try {
    permissions = await client.myPermissions();
  } catch (error) {
    return json({ error: `Your session could not be read: ${error.message}` }, 401);
  }

  // Who they are and which shell their screens live in. Best-effort: a missing profile row must
  // not stop somebody whose permissions are already known.
  const userId = jwtSubject(token);
  let role = null;
  let name = null;
  if (userId) {
    try {
      const rows = await client.select("users", `select=id,name,role&id=eq.${userId}`);
      role = rows?.[0]?.role ?? null;
      name = rows?.[0]?.name ?? null;
    } catch {
      /* the permissions are what matter */
    }
  }

  // The membership's branch scope is the authority the app's own screens use. A Co-Owner is not
  // an admin in the membership table: their delegated experience and branch list live here, and
  // the database's branch policies already use the same scope. Read it before building tools.
  let access = null;
  let activeBranchId = null;
  let allowedBranchIds = null;
  // One failed context read must not throw away the other two. If the branch read fails, the
  // tools still fail closed; if only the allowed-list read fails, the active branch is enough.
  const [accessResult, branchResult, allowedResult] = await Promise.allSettled([
    client.rpc("get_my_access_context"),
    client.rpc("current_branch_id"),
    client.rpc("allowed_branch_scope"),
  ]);
  if (accessResult.status === "fulfilled" && accessResult.value && typeof accessResult.value === "object") {
    access = accessResult.value;
  }
  if (branchResult.status === "fulfilled" && typeof branchResult.value === "string" && branchResult.value) {
    activeBranchId = branchResult.value;
  }
  if (allowedResult.status === "fulfilled" && Array.isArray(allowedResult.value)) {
    allowedBranchIds = allowedResult.value.filter((id) => typeof id === "string" && id);
  }

  const experience =
    access?.experience === "owner" || access?.experience === "co_owner" || access?.experience === "employee"
      ? access.experience
      : role === "owner"
        ? "owner"
        : "employee";
  const seesAllBranches = experience === "owner";
  const shell = shellFor(role, permissions, experience);
  const ctx = {
    client,
    permissions,
    shell,
    role,
    userId,
    experience,
    branchId: activeBranchId,
    branchScope: seesAllBranches ? null : allowedBranchIds,
    seeAllBranches: seesAllBranches,
  };

  let body = {};
  try {
    body = req.method === "POST" ? await req.json() : {};
  } catch {
    return json({ error: "That request could not be read." }, 400);
  }

  // Which capabilities this account has — the screen shows this so the boundary is visible
  // rather than something the user has to discover by being refused.
  if (body.action === "tools") {
    const offered = new Set(toolsFor(permissions).map((t) => t.name));
    return json({
      user: { name, role: experience === "co_owner" ? "co-owner" : experience, experience },
      shell,
      permissions,
      scope: { experience, branchId: activeBranchId, allBranches: seesAllBranches },
      tools: toolsFor(permissions).map((t) => ({ name: t.name, title: t.title, permission: t.permission })),
      withheld: [...TOOLS_BY_NAME.values()]
        .filter((t) => !offered.has(t.name))
        .map((t) => ({ name: t.name, title: t.title, permission: t.permission })),
      model: geminiKey ? geminiModel : "built-in",
    });
  }

  const text = String(body.text ?? "").trim();
  let photo = null;
  try {
    photo = body.photo && typeof body.photo === "object" ? normalisePhoto(body.photo) : null;
  } catch (error) {
    return json({ error: error.message }, 400);
  }
  if (!text && !photo) return json({ error: "Ask me something." }, 400);
  if (photo && !geminiKey) {
    return json({
      answer: "I cannot read a photo just now. Type the sale number written on it and I will look it up.",
      speak: "I cannot read photos just now. Type the sale number on it and I will look it up.",
      model: "built-in",
      widgets: [],
      sources: [],
      calls: [],
    });
  }

  try {
    const result = await ask({
      text: text || "Read this photo and tell me about the sale it shows.",
      ctx,
      photo,
      // The transcript the app is holding, capped by the provider. Nothing is stored.
      history: Array.isArray(body.history) ? body.history.slice(-8) : [],
      apiKey: geminiKey,
      model: geminiModel,
      fallbackModel: geminiFallbackModel || undefined,
      baseUrl: modelBaseUrl,
    });
    return json({
      answer: result.answer,
      speak: result.speak ?? result.answer,
      model: result.model,
      refused: !!result.refused,
      permission: result.permission ?? null,
      notes: result.notes ?? [],
      // The detail the answer is about, as data. The chat draws it in place — the screen name is
      // a small extra for whoever wants to act on it, never the way the answer is delivered.
      widgets: result.widgets ?? [],
      sources: result.sources ?? [],
      calls: result.calls ?? [],
    });
  } catch (error) {
    console.error("[assistant] failed:", error?.message);
    return json({ error: "I could not finish that. Please try again." }, 500);
  }
}

export { corsHeaders };
