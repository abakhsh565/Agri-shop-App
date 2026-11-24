# Voice notes and photos — the contract shared with the Farmer App

Status: **development applied and proved; staging pending apply.** Nothing here changes an existing
call: text messaging is untouched (migration `0336` only relaxes the body check to allow an empty
caption, and every existing row still satisfies it).

Two things are separate on purpose:

- **the conversation** (who said what, to whom, when) lives in `farmer_messages`, exactly as before;
- **the file** lives in a private bucket, and only a short-lived signed link can fetch it.

## 1. Who may do what

| Caller | Credential | May |
|---|---|---|
| Farmer app (never signed in) | `x-farmer-token: <token>` from `farmer_api_join_shop` | upload, read links for **his own** conversation |
| Dealer app (signed in) | `Authorization: Bearer <supabase access token>` | upload, read links for farmers **linked to his active shop** |

The folder is never supplied by the client. The server derives `<shop_id>/<farmer_id>/<uuid>.<ext>`
from the token or the membership, so an upload cannot be aimed at another conversation. A send RPC
also refuses a `storage_path` that is not under the shop/farmer it resolved itself.

## 2. Upload

```
POST {SUPABASE_URL}/functions/v1/farmer-media?kind=voice&mime=audio/webm&duration_ms=4200
     (dealer also adds &farmer_id=<uuid>)
Headers:  x-farmer-token: <token>        OR      Authorization: Bearer <jwt>
          Content-Type: audio/webm | image/png | …
Body:     the raw bytes (1 byte … 10 MB)
```

200 → `{ "storage_path": "<shop>/<farmer>/<uuid>.webm", "content_type": "audio/webm", "size_bytes": 4211, "farmer_id": "…", "duration_ms": 4200 }`

Refusals: `400 VALIDATION` (kind/mime/duration/size), `401 NOT_AUTHORIZED` (bad or missing
credential), `403 NOT_LINKED` (dealer uploading for a farmer of another shop), `413 TOO_LARGE`.

Allowed types: `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg`, `image/jpeg`, `image/png`,
`image/webp`. A voice note **must** carry `duration_ms` (1 … 600000); an image must not.

## 3. Record the message

The upload does not write the conversation row — that is a separate, ordinary RPC, so a failed
upload never leaves a message with no file.

Farmer:

```sql
select farmer_api_send_attachment(
  p_token        := '<token>',
  p_kind         := 'voice',            -- or 'image'
  p_storage_path := '<storage_path from the upload>',
  p_mime_type    := 'audio/webm',
  p_size_bytes   := 4211,
  p_duration_ms  := 4200,               -- null for an image
  p_body         := null                -- optional caption, ≤ 2000 chars
);
-- { id, created_at, direction:"farmer", attachment:{ id, kind, mime_type, size_bytes, duration_ms, storage_path } }
```

Dealer:

```sql
select send_farmer_attachment(
  p_farmer_id    := '<uuid>',
  p_kind         := 'voice',
  p_storage_path := '<storage_path>',
  p_mime_type    := 'audio/webm',
  p_size_bytes   := 4211,
  p_duration_ms  := 2600,
  p_body         := null
);
```

## 4. Read the metadata

One call per thread — not one per message.

```sql
-- farmer
select farmer_api_media(p_token := '<token>', p_shop_id := null);
-- dealer
select get_farmer_media(p_farmer_id := '<uuid>');
```

Both return an array of:

```json
{ "message_id": "…", "attachment_id": "…", "kind": "voice", "mime_type": "audio/webm",
  "size_bytes": 4211, "duration_ms": 4200, "width": null, "height": null,
  "storage_path": "…", "sender": "owner" | "farmer", "created_at": "2026-11-24T…Z" }
```

`duration_ms` is what the bubble shows without downloading the audio; `sender` is who sent it.
Conversations without files simply return `[]` (never an error), so a client written for text still
works.

## 5. Play it

```
GET {SUPABASE_URL}/functions/v1/farmer-media?message_id=<uuid>
Headers: x-farmer-token: <token>   OR   Authorization: Bearer <jwt>
```

200 → `{ "message_id", "kind", "mime_type", "size_bytes", "duration_ms", "sender", "created_at",
"url": "<signed storage url>", "expires_in": 60 }`

The URL is a **60-second signature** on a private object. Fetch it when the user presses play, use
it immediately, and re-request after `expires_in`. It cannot be cached in a message row, shared, or
replayed later.

Refusals: `401 NOT_AUTHORIZED` (no credential), `404 NOT_FOUND` (not there **or** not yours — the
server deliberately does not distinguish, so a caller cannot probe another conversation).

## 6. Why the bucket is private and has no client policy

A farmer has no JWT, so storage RLS cannot scope him. A single policy for signed-in users would
make every shop's audio readable by every other shop. So `farmer-chat-media` is private with **no**
`storage.objects` policy for `anon`/`authenticated`: the function authorises once, with the service
role, and speaks for the caller. The proof for that is in `0336`'s own `$proof$` block and in the
local end-to-end run (see the commit body).

## 7. Environment isolation

Each environment has its own project and therefore its own `farmer-chat-media` bucket and its own
`farmer_message_attachments` rows. No path, URL or row is shared between dev, staging and
production; a signed URL minted by staging cannot address a production object (different project
origin, different credentials). Nothing in this feature copies files between environments.
