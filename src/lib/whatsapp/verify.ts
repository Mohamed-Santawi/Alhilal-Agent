import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta signs every webhook body with HMAC-SHA256 using the App Secret.
 * Header: X-Hub-Signature-256: sha256=<hex>
 * Must be computed on the RAW body (before JSON.parse).
 */
export function verifyWhatsAppSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
