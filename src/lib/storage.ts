import "server-only";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/env";

// Private Storage for email attachments.
//
// Two credential paths, on purpose. A user-driven sync uses their session, so
// the storage policy scopes writes to their own folder. The nightly cron has no
// session, so it needs the service-role key. Whichever is available wins.

export const ATTACHMENTS_BUCKET = process.env.SUPABASE_ATTACHMENTS_BUCKET ?? "email files";

/// Signed URLs are short-lived by design: the bucket is private, and a link
/// that outlives the page it was rendered on is a leak waiting to happen.
const SIGNED_URL_TTL_SECONDS = 60 * 10;

async function storageClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey) {
    const { url } = supabaseEnv();
    return createServiceClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).storage;
  }
  return (await createSessionClient()).storage;
}

/// Objects live under the owner's user id, which is what the storage policy
/// keys off. Filenames are sanitised: Gmail filenames contain spaces, slashes
/// and the occasional emoji.
export function attachmentPath(
  userId: string,
  gmailMessageId: string,
  attachmentId: string,
  filename: string,
): string {
  const safeName = filename.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
  return `${userId}/${gmailMessageId}/${attachmentId.slice(0, 24)}-${safeName}`;
}

export async function uploadAttachment(
  path: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const storage = await storageClient();
  const { error } = await storage.from(ATTACHMENTS_BUCKET).upload(path, body, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
}

export async function downloadAttachment(path: string): Promise<Buffer> {
  const storage = await storageClient();
  const { data, error } = await storage.from(ATTACHMENTS_BUCKET).download(path);
  if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function signedUrl(path: string): Promise<string | null> {
  const storage = await storageClient();
  const { data, error } = await storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  return error ? null : (data?.signedUrl ?? null);
}
