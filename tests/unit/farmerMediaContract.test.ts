import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * 0336's contract, asserted on the file that ships it.
 *
 * The accent is on the boundaries, because that is where a voice note differs from a text message:
 * the file lives in a private bucket, a farmer has no JWT, and one shared storage policy would hand
 * every shop's audio to every other shop. These assertions fail if that shape is edited away.
 */
const ROOT = join(__dirname, '..', '..');
const sql = readFileSync(join(ROOT, 'supabase/migrations/0336_a_voice_note_is_still_a_message.sql'), 'utf8');
const functionSource = readFileSync(join(ROOT, 'supabase/functions/farmer-media/index.ts'), 'utf8');

describe('0336 — voice and image files', () => {
  test('the bucket is private and bounded', () => {
    expect(sql).toMatch(/values \(\s*'farmer-chat-media', 'farmer-chat-media', false, 10485760/);
    expect(sql).toMatch(/on conflict \(id\) do update\s+set public = false/);
  });

  test('no storage policy is created for a client role', () => {
    expect(sql, 'a client-side storage policy would break tenant isolation').not.toMatch(
      /create policy[\s\S]*?on storage\.objects/i,
    );
  });

  test('the attachment table is server-only', () => {
    expect(sql).toContain('alter table public.farmer_message_attachments enable row level security');
    expect(sql).toContain(
      'revoke all on table public.farmer_message_attachments from public, anon, authenticated;',
    );
  });

  test('each sender is granted to exactly one role', () => {
    expect(sql).toContain(
      'grant execute on function public.farmer_api_send_attachment(text, text, text, text, integer, integer, text, uuid)\n  to anon;',
    );
    expect(sql).toMatch(
      /grant execute on function public\.send_farmer_attachment\(uuid, text, text, text, integer, integer, text\)\s+to authenticated;/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.farmer_api_send_attachment\([^)]*\)\s+from public, authenticated;/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.send_farmer_attachment\([^)]*\)\s+from public, anon;/,
    );
  });

  test('the service-role lookup is the only way the function reads a file', () => {
    expect(sql).toMatch(
      /revoke all on function public\.farmer_media_attachment\(uuid, text, uuid\) from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.farmer_media_attachment\(uuid, text, uuid\) to service_role;/,
    );
    expect(sql).toMatch(/grant execute on function public\.farmer_media_identity\(text\) to service_role;/);
    expect(functionSource).toContain('farmer_media_attachment');
  });

  test('a send refuses a path outside the conversation', () => {
    // Both senders compare the derived prefix; the comparison must be positional, not a substring.
    expect(sql.match(/position\([^)]*in p_storage_path\) <> 1/g)?.length).toBe(2);
  });

  test('voice needs a duration and an image must not have one', () => {
    expect(sql).toContain("check (kind <> 'voice' or duration_ms is not null)");
    expect(sql).toContain("check (kind <> 'image' or duration_ms is null)");
    expect(functionSource).toMatch(/duration_ms between 1 and 600000/);
  });

  test('the body may be empty but is still capped at 2000 characters', () => {
    expect(sql).toContain('drop constraint if exists farmer_messages_body_check');
    expect(sql).toMatch(/add constraint farmer_messages_body_check\s+check \(length\(btrim\(body\)\) <= 2000\);/);
  });

  test('the readers answer metadata, never a URL', () => {
    for (const fn of ['farmer_api_media', 'get_farmer_media']) {
      const body = sql.split(`function public.${fn}`)[1] ?? '';
      expect(body, `${fn} must not invent a URL`).not.toContain("'url'");
      expect(body).toContain("'duration_ms'");
      expect(body).toContain("'sender'");
    }
  });

  test('the function mints a short-lived link and verifies a JWT properly', () => {
    expect(functionSource).toContain('createSignedUrl');
    expect(functionSource).toContain('SIGNED_URL_SECONDS = 60');
    expect(functionSource, 'a decoded-but-unverified JWT is not an identity').toContain('auth.getUser(jwt)');
  });
});
