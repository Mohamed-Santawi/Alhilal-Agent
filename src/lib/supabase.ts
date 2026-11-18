import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let admin: SupabaseClient | null = null;

/** Server-only client with the service role (bypasses RLS). Never import in client components. */
export function db(): SupabaseClient {
  if (!admin) {
    const e = env();
    admin = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return admin;
}
