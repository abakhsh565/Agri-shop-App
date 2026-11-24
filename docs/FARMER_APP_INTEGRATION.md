# Talking to the shop — the farmer app contract

This is the whole surface between AgriShop and the farmer app. Nothing in the farmer app needs
the shop's database, its service key, or a login: it needs one credential and five calls.

## What the shop needs from the farmer app

Three things, and only three:

1. **The farmer's credential** (`token`, 64 characters). It is issued by the shop when the farmer
   joins — either by walking in with the shop code, or by an invitation the owner sends. Every
   call carries it. It is the farmer's identity; there is no farmer login.
2. **A phone token** for push, registered once after the credential is stored (see below).
3. **A pull on open.** Push is best-effort; the outbox is the truth. On launch and on resume, read
   the thread and the notifications once, then render. A farmer must see his conversation even
   if he never granted notification permission.

## Getting in

Two doors, both already live in the shop app:

| How | What the farmer does | Result |
| --- | --- | --- |
| Shop code | Owner: Messages → `+` → *Show shop code* (6 characters, QR `agrishop://join?code=XXXXXX`). Farmer enters it once. | `farmer_api_join_shop` returns `{ token, farmer_id, shop_id, … }`. He is connected to that shop immediately — no approval step. |
| Invitation | Owner: farmer profile → *Invite to farmer app* → QR `agrishop://farmer?token=…` or WhatsApp share. | The same token, already tied to the farmer the owner was looking at. |

Re-issuing an invitation rotates the token and the old one stops working (`NOT_AUTHORIZED`).
A second join with the same code and phone returns `token: null` with `already_connected: true` —
keep the token already stored; do not overwrite it with null.

## The calls

All are `POST {SUPABASE_URL}/rest/v1/rpc/{name}` with headers `apikey: <anon key>` and
`Authorization: Bearer <anon key>` — the farmer's token is a **parameter**, never the bearer.

| Call | Parameters | What it does |
| --- | --- | --- |
| `farmer_api_me` | `p_token` | The farmer and the shop he is connected to. Use on launch to validate a stored token. |
| `farmer_api_thread` | `p_token`, `p_shop_id` (null = his only shop) | The conversation: messages, open credit asks, visit asks, the shop's identity. |
| `farmer_api_send_message` | `p_token`, `p_body`, `p_shop_id` | Writes a chat message **and** notifies the shop — in-app, plus a push to the owner's phone. |
| `farmer_api_create_credit_request` | `p_token`, `p_amount`, `p_note`, `p_shop_id`, `p_branch_id` | A credit ask. Appears in the shop's thread as one event, not a message beside a request. |
| `farmer_api_request_visit` | `p_token`, `p_purpose`, `p_window`, `p_shop_id`, `p_branch_id` | A field-visit ask. |
| `farmer_api_answer_offer` | `p_token`, `p_request_id`, `p_accept`, `p_note` | Accept or decline the shop's offer. The owner is told immediately. |
| `farmer_api_notifications` | `p_token` | The shop→farmer outbox: replies, offers, visit changes (`kind`, `title`, `body`, `payload`, `created_at`). |
| `farmer_api_register_device` | `p_token`, `p_device_token`, `p_platform` | Registers this phone for push. `p_platform` is `android`, `ios` or `web`. |
| `farmer_api_shops` | `p_token` | The dealers he can see: every shop that opted into the marketplace, plus every shop he is already linked to (`is_linked`). Public profile only — name, city, address, phone, type, logo, coordinates. No staff code, email or documents. |
| `farmer_api_products` | `p_token`, `p_shop_id` (null = his own shop), `p_search`, `p_limit` (1–100, default 50), `p_offset` | That shop's active catalogue: `product_id`, name, category, base unit, image, `featured`, `price_from`/`price_to`, and `variants[]` with `price`, `in_stock`, `low_stock`. Answers `count` so the app can page. |

### Rendering the catalogue honestly

`in_stock` / `low_stock` are STATES, never quantities — the shop does not publish how many bags it
holds, and a farmer token must not become a way to count a competitor's shelves. Show "in stock" /
"running low" / "out", not a number.

The two calls answer `count` and echo `limit`/`offset`; page with them instead of loading everything.
`farmer_api_products` with no `p_shop_id` uses the farmer's only shop, so a one-shop app needs one
call. A shop that is not in the marketplace and is not linked to this farmer is `NOT_FOUND` — treat
it as "that dealer is not available", not as a crash.

Errors come back as `{ code: "P0001", message: "NOT_AUTHORIZED: …" }`. Treat `NOT_AUTHORIZED` as
"the credential is gone — ask the shop for a new invitation", and `NOT_FOUND`/`VALIDATION` as
something to show the farmer.

## Push on the farmer's phone

1. The farmer app is built with its own Firebase project (or the same one, a different app id).
   Its `google-services.json` belongs to the **farmer app's** package.
2. After the credential is stored and notification permission is granted, get the FCM token and
   call `farmer_api_register_device`. Re-register on every launch: the token rotates, and the
   shop moves the row instead of duplicating it.
3. Every push the shop sends carries the outbox row's own words:

```json
{
  "notification": { "title": "دکان کا نیا پیغام", "body": "…" },
  "data": {
    "route": "/",
    "notification_id": "…",
    "kind": "message | credit_offer | visit_scheduled | visit_rescheduled"
  }
}
```

`data.route` is `/` for the farmer — open the conversation. `notification_id` is the outbox row,
so a tap can mark exactly that row read locally.

Android 8+ needs a notification channel before the first push arrives; create it at startup with
the id `agrishop` (the shop app uses the same id, so one channel name in the OS settings).

## How the owner talks to a farmer

One composer, and the channel is a choice at send time:

- **In the app** → `send_farmer_message(farmer_id, body, 'app')`. The message lands in the farmer's
  thread, the outbox gets a `message` row, and his phone gets a push. This is the default.
- **On WhatsApp** → the same call with `'whatsapp'` records what was said *and* opens WhatsApp with
  the text, for a farmer who has not installed the app yet. The thread is still the record.

The rest happens in the conversation, never in a separate module:

- a credit ask → *Send offer* → the farmer accepts or declines in the app (`farmer_api_answer_offer`),
  and the owner's thread moves to `accepted`/`declined` on its own;
- a visit ask → *Schedule* → the farmer sees the day and any reschedule.

So: **the shop never needs the farmer app to send him something.** WhatsApp works today; the app
adds the read receipt, the offer answer and the push.

## What still has to be switched on (owner/server side)

Push delivery leaves this repository in one piece: `supabase/functions/send-push`. It is the only
code that talks to Firebase, and it needs three things this repo must not contain:

1. Firebase **service-account JSON** — one per Firebase project, because an FCM token is only
   addressable by the project that minted it. The farmer app lives in `farmer-app-c4590`; the
   shop app's `android/app/google-services.json` names `project-b3c00275-631c-4f53-85d`. So:
   - `FCM_SERVICE_ACCOUNT_FARMER` — `farmer-app-c4590`'s key (already supplied).
   - `FCM_SERVICE_ACCOUNT_OWNER` — the key of whichever project has `com.agrishop.app`
     registered. If the shop app is instead added as a second Android app to
     `farmer-app-c4590`, one `FCM_SERVICE_ACCOUNT` covers both and this variable is unnecessary.
   The shop app's key cannot be minted from the farmer app's key — IAM does not cross projects.
   A key from the wrong project makes FCM answer 404/UNREGISTERED, which is indistinguishable
   from an uninstalled app; that is why the sender picks the key by recipient.
2. `PUSH_DISPATCH_SECRET` — any random string; the caller must send it as `x-push-secret`.
3. A schedule: run the function every minute (`pg_cron` + `pg_net`, or the Supabase dashboard's
   scheduled functions). Until it runs, notifications queue in `push_deliveries` and nothing is
   lost.

Deploy: `supabase functions deploy send-push --no-verify-jwt`, then set the two secrets with
`supabase secrets set`. Test without Firebase first:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/send-push" \
  -H "x-push-secret: $PUSH_DISPATCH_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'
```

It returns what it *would* send and marks nothing. When the service account is set, the same call
without `dryRun` delivers and stamps `sent_at`.

## Verified, and not

Verified against the local database (2026-11-22): a farmer joins with the shop code; his message,
credit ask and visit ask each produce exactly one owner notification and one queued push addressed
to the owner's registered phone; the owner's reply produces one farmer outbox row and one queued
push addressed to the farmer's phone; an employee's sale stamps `sale` with the employee's name and
queues a push for the owner. Routes are `/admin/messages/<farmerId>`, `/admin/sales/<saleId>`,
`/admin/notifications`.

Not verified here: an actual FCM delivery (no Firebase service-account key in this environment, and
the Android build needs Java), so "FCM accepted the message" is the sender's contract, not an
observed banner. The sender's dry run needs the edge runtime to exercise.
