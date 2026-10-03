/**
 * Envelope encryption for user secrets.
 * Each secret gets its own random data key (DEK) used with AES-256-GCM.
 * The DEK is itself wrapped with the master key (KEK) from MASTER_KEY.
 * Swap `wrapKey/unwrapKey` for AWS KMS / GCP KMS calls in production without touching callers.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

const KEK = Buffer.from(env.MASTER_KEY.slice("base64:".length), "base64");
if (KEK.length !== 32) throw new Error("MASTER_KEY must be 32 bytes base64 (openssl rand -base64 32)");

function wrapKey(dek: Buffer) { const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", KEK, iv); const ct = Buffer.concat([c.update(dek), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]); }
function unwrapKey(wrapped: Buffer) { const iv = wrapped.subarray(0, 12), tag = wrapped.subarray(12, 28), ct = wrapped.subarray(28); const d = createDecipheriv("aes-256-gcm", KEK, iv); d.setAuthTag(tag); return Buffer.concat([d.update(ct), d.final()]); }

export function encryptSecret(plain: string, aad: string) {
  const dek = randomBytes(32), iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", dek, iv); c.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return { ciphertext, iv, tag: c.getAuthTag(), wrappedKey: wrapKey(dek), last4: plain.slice(-4) };
}
export function decryptSecret(row: { ciphertext: Buffer; iv: Buffer; tag: Buffer; wrappedKey: Buffer }, aad: string) {
  const dek = unwrapKey(row.wrappedKey);
  const d = createDecipheriv("aes-256-gcm", dek, row.iv); d.setAAD(Buffer.from(aad)); d.setAuthTag(row.tag);
  return Buffer.concat([d.update(row.ciphertext), d.final()]).toString("utf8");
}
export function safeEqual(a: string, b: string) { const A = Buffer.from(a), B = Buffer.from(b); return A.length === B.length && timingSafeEqual(A, B); }
