import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for the one secret this app stores in its own database: the Gmail
// refresh token. The key lives only in the environment, so a database dump is
// not enough to read the user's mail.

const ALGORITHM = "aes-256-gcm";

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "APP_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32",
    );
  }
  const buffer = Buffer.from(raw, "base64");
  if (buffer.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64 encoded.");
  }
  return buffer;
}

/// Returns "iv.ciphertext.authTag", all base64.
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv.toString("base64"), ciphertext.toString("base64"), cipher.getAuthTag().toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
  const [iv, ciphertext, authTag] = payload.split(".");
  if (!iv || !ciphertext || !authTag) throw new Error("Malformed encrypted value.");

  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
