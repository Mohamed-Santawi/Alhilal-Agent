import { createHash, randomBytes } from "node:crypto";
import { db } from "../supabase";

const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");

/** Creates a one-time link token. Older unused tokens of the same purpose for this customer are revoked. */
export async function issueFormToken(customerId: string, purpose: string, ttlMinutes = 60): Promise<string> {
  await db().from("form_tokens").delete().eq("customer_id", customerId).eq("purpose", purpose).is("used_at", null);
  const raw = randomBytes(24).toString("base64url");
  const r = await db().from("form_tokens").insert({
    customer_id: customerId,
    purpose,
    token_hash: hash(raw),
    expires_at: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
  });
  if (r.error) throw r.error;
  return raw;
}

/** Read-only check (for rendering the page). */
export async function peekFormToken(raw: string, purpose: string): Promise<{ customer_id: string } | null> {
  if (!raw || raw.length > 100) return null;
  const r = await db()
    .from("form_tokens")
    .select("customer_id")
    .eq("token_hash", hash(raw)).eq("purpose", purpose)
    .is("used_at", null).gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return r.data ?? null;
}

/** Atomically marks the token used. Returns null if it is invalid, expired or already used. */
export async function claimFormToken(raw: string, purpose: string): Promise<{ id: string; customer_id: string } | null> {
  if (!raw || raw.length > 100) return null;
  const r = await db()
    .from("form_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", hash(raw)).eq("purpose", purpose)
    .is("used_at", null).gt("expires_at", new Date().toISOString())
    .select("id, customer_id")
    .maybeSingle();
  return r.data ?? null;
}

/** Undo a claim if saving failed, so the customer can retry with the same link. */
export async function releaseFormToken(id: string) {
  await db().from("form_tokens").update({ used_at: null }).eq("id", id);
}
