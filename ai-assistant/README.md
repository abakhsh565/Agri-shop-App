# AgriShop Assistant

An assistant inside the app that answers from **the shop's real records**, strictly within what the
person asking may already see. Ask it what today's sales were, how much a customer owes, what needs
reordering, or how to do something in the app it did not explain well enough.

It is a tab on the session that is already signed in. There is **no second sign-in, no assistant
account and no separate screen with its own reach** — the same token that draws the app's screens
is the token every answer is read with.

---

## Where the code lives

| Piece | File | What it is |
|---|---|---|
| The function (shipped) | `supabase/functions/assistant/index.ts` | Deno entrypoint: reads the secrets, wraps `handler.mjs`. |
| The rules (shipped) | `supabase/functions/assistant/handler.mjs` | One request path — caller's token, tool list, question. |
| The tools (shipped) | `supabase/functions/assistant/tools.mjs` | Every capability, and the permission each one sits behind. |
| The models (shipped) | `supabase/functions/assistant/providers.mjs` | Gemini function-calling, the built-in answerer, the invented-figure guard. |
| The help text (shipped) | `supabase/functions/assistant/help-corpus.mjs` | The app's own tutorials, bundled so the function reads no files. |
| The app's client | `src/lib/assistant.ts` | Calls the function with the open session. |
| The chat screen | `src/pages/assistant/AssistantPage.tsx` | The tab, both shells (`/admin/assistant`, `/employee/assistant`). |
| The cards | `src/components/assistant/AssistantWidget.tsx` | The detail, drawn in the conversation from the app's own primitives. |
| Local runner | `ai-assistant/server/dev.mjs` | Runs the **same** `handle()` on this machine, for development. |
| The proof | `ai-assistant/server/selftest.mjs` | The permission wall, the numbers, and "nothing is kept" — with evidence. |
| The port's lane | `tests/integration/assistantPermission.test.ts` | The same wall, proved against the real database in the app's own test run. |

This folder holds only the runner and the proof. It used to hold a second chat page with its own
sign-in; that is gone, because the assistant is the app's now.

---

## The rule the whole design rests on

**There is no SQL tool and no generic "read anything" tool.** The model cannot ask for data; it can
only ask for one of the named tools, each of which declares the permission it needs. `runTool`
checks that permission twice:

1. against the caller's own permission list — the same `get_my_permissions()` the app reads, so the
   assistant never offers a tool the app itself would hide;
2. against the **database**, by calling `has_permission(code)` as the caller. The database is the
   authority on permissions here, so if the cached list and the database ever disagree, the
   database wins and the tool refuses.

Anything the caller may not see is a tool that does not exist for them. There is no path by which
the model can be talked into reading a table directly, and no number in an answer that did not come
out of one of those functions.

### Owner, Co-Owner and employee

The server reads the same `get_my_access_context()`, `current_branch_id()` and
`allowed_branch_scope()` the app's own screens use.

* **Owner** — every permission, no branch predicate. Tools read the whole shop the owner's token
  can reach.
* **Co-Owner** — the delegated permission list, the admin shell, and only the branch they are
  working in. The membership row is deliberately `employee`; the Co-Owner experience is what
  opens the Owner-side shell, never a widened membership.
* **Employee** — only their granted tools and the active branch.

Every sales, sale lookup and activity query carries `branch_id=eq.<active branch>` for a
restricted account. If that branch cannot be read, the tool refuses rather than falling back to
all branches. The database's branch policies remain the final authority; the predicate is the
second lock.

### Every picture is capped at 500 KB

Product photos, customer and supplier pictures, profile photos, business documents, finance
receipts and the assistant's bill photo all go through `src/lib/imageCompression.ts`. It classifies
the picture as text, photo or graphic, keeps the higher resolution and quality floor for text,
preserves transparency where WebP supports it, and steps the size down only until the result fits.
A crop is marked so it is not encoded twice, but a cropped image still over the ceiling is
re-encoded. The upload helpers refuse an image that could not be brought under 500 KB.

Animated GIFs and SVGs are not rasterised because that would destroy the animation or the vector;
they are the documented exceptions, not a silent pass-through.

### A finding about the app, not about the assistant

Row-level security here scopes by **shop** (`shop_id = current_shop_id()`), not by permission. An
employee's own token can read `product_variants.cost_price` over REST even though they hold no
`reports.view` — measured, repeatedly, in `npm run selftest` (the `app.raw-read-gap` line). The
assistant cannot reach that, because it never exposes a generic read and `product_stock` only asks
PostgREST for `cost_price` when the caller holds `reports.view`. The app itself can, and that is a
finding for the app: close it with a column-level policy or a view.

### Nothing is kept

The transcript lives in the chat screen's own memory and nowhere else, and only the last 8 turns
travel with the next question as context. There is no table, no file and no log of any
conversation — which satisfies "no history older than 24 hours" by keeping none at all.

---

## Answering in the conversation, not by link

A question about a number or a list is answered **in place**: the chat draws the card for it,
built from the same primitives the app's own screens use (`ListCard`, `ListRow`, the `ds-stat`
tiles, `EmptyState`), keyed to the tool that produced the facts. Sales get stat tiles and a row per
employee; profit gets revenue, cost, profit and margin; a customer gets their standing, their
ledger totals and their last purchase; stock, low stock, a sale, supplier dues, employee activity,
permissions and help topics each get their own card. An ambiguous customer name draws the
candidates as rows that ask again rather than guessing whose balance to read out. The screen name a
card comes from is a small label for whoever wants to act on it — never the way the answer is
delivered.

---

## Running it locally

```bash
node ai-assistant/server/dev.mjs                       # http://localhost:64701
# in .env.local: VITE_ASSISTANT_DEV_URL=http://127.0.0.1:64701
npm run dev
```

The runner reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from `.env.local` first, so it talks
to the same local stack as the app; `.env.qa` is the fallback. Then sign in to the app normally and
open the Assistant tab. No second login, no deployed function, and the code answering is the code
that ships. Without a `GEMINI_API_KEY` the built-in answerer answers from the same tools — it cannot
read a photo, and it says so.

```bash
npm run selftest                    # from ai-assistant/
npx vitest run tests/integration/assistantPermission.test.ts
```

## Deploying it

```bash
supabase functions deploy assistant
supabase secrets set GEMINI_API_KEY=...
```

`GEMINI_API_KEY` is optional. Without it every answer comes from the built-in layer, which uses the
same tools and refuses the same things; with it, questions can be asked loosely, in Urdu, or with a
photo of a bill.

## Answering from a gateway instead of Google

The model layer already speaks the Gemini `generateContent` wire format and takes its credential as
`?key=…`. That is also the format several gateways serve, so the assistant can answer from one
without a second provider implementation, a second tool gate or a second set of rules.

```bash
# A self-hosted OmniRoute:
ASSISTANT_MODEL_BASE_URL=http://localhost:20128/v1beta
GEMINI_API_KEY=<your OmniRoute API key>   # the gateway's key; the variable name is historical
GEMINI_MODEL=auto                         # or any model the gateway exposes
```

| Variable | Meaning |
|---|---|
| `ASSISTANT_MODEL_BASE_URL` | Host serving `{base}/models/{model}:generateContent`. Unset → Google. |
| `GEMINI_API_KEY` | The credential, whichever host is in use. |
| `GEMINI_MODEL` | The model id, as the host names it. |
| `GEMINI_FALLBACK_MODEL` | Second model tried when the first is spent or unavailable. |

The same variable works on the deployed function (`supabase secrets set ASSISTANT_MODEL_BASE_URL=…`)
— but note that an edge function runs in the cloud and cannot reach a gateway on your own machine.
There it must be a host the function can route to. For a local gateway, run the dev harness, which
is why it exists.

Health check reports where calls are going, so a failing answer can be traced to its destination:

```bash
curl -s localhost:64701/health
# → {"ok":true,"model":"auto","gateway":"http://localhost:20128/v1beta", …}
```

**What this does not change.** Every number still comes from a tool, the permission wall is still
checked twice (the caller's list, then the database), nothing is stored, and the built-in layer is
still the last resort when no model answers at all.

**What to watch.** The gateway must carry **function calling** through to the model — the tool loop
depends on it, and a model behind the gateway that cannot call tools will fall back to the built-in
answerer. Gateways also apply their own routing and quota, so a model that works today can be
rate-limited tomorrow; that is the gateway's layer, not this one.

---

## Honest limits

- **Voice both ways** uses the Web Speech API, so it works in Chrome and the Android WebView and
  has not been proven on a device.
- **Photos** need the model key; without it the assistant asks for the sale number instead.
- **One question costs one or two model calls.** On a free-tier key a burst can hit a rate limit;
  the assistant waits once and retries, then falls back to the built-in layer, says so on screen,
  and cannot read photos in that state.
- **Read-only.** It reports; it does not record a payment, void a sale or change a price.
