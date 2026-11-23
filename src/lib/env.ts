import { z } from "zod";

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  WHATSAPP_TOKEN: z.string().min(1),          // permanent System User token
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),     // to verify X-Hub-Signature-256
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),   // any random string, set the same in Meta dashboard
  WHATSAPP_API_VERSION: z.string().default("v21.0"),

  // WhatsApp Flows
  WHATSAPP_REGISTRATION_FLOW_ID: z.string().optional(),
  // auto = Flow → web form → chat (each one falls back to the next); or force one of them
  REGISTRATION_MODE: z.enum(["auto", "flow", "web", "chat"]).default("auto"),
  // Public URL of this app, used in links sent on WhatsApp. On Vercel it is detected automatically.
  PUBLIC_BASE_URL: z.string().url().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  WHATSAPP_FLOW_MODE: z.enum(["draft", "published"]).default("draft"), // draft = test before publishing the flow
  PRIVACY_POLICY_URL: z.string().url().optional(),
});

let cached: z.infer<typeof schema> | null = null;

/** https://your-app.vercel.app (no trailing slash), or undefined if unknown. */
export function publicBaseUrl(): string | undefined {
  const e = env();
  const url = e.PUBLIC_BASE_URL ?? (e.VERCEL_PROJECT_PRODUCTION_URL ? `https://${e.VERCEL_PROJECT_PRODUCTION_URL}` : undefined);
  return url?.replace(/\/+$/, "");
}

/** PRIVACY_POLICY_URL if set, otherwise this app's /privacy page. */
export function privacyUrl(): string | undefined {
  const base = publicBaseUrl();
  return env().PRIVACY_POLICY_URL ?? (base ? `${base}/privacy` : undefined);
}

export function env() {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
