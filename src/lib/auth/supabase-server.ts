import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Supabase client bound to the logged-in user's cookies (for auth only — data access goes through db()). */
export async function authClient() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* called from a Server Component — middleware refreshes */ }
        },
      },
    },
  );
}
