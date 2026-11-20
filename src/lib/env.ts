import { z } from "zod";

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  WHATSAPP_TOKEN: z.string().min(1), // permanent System User token
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1), // to verify X-Hub-Signature-256
  WHATSAPP_VERIFY_TOKEN: z.string().min(1), // any random string, set the same in Meta dashboard
  WHATSAPP_API_VERSION: z.string().default("v21.0"),

  // WhatsApp Flows
  WHATSAPP_REGISTRATION_FLOW_ID: z.string().min(1),
  WHATSAPP_FLOW_MODE: z.enum(["draft", "published"]).default("draft"), // draft = test before publishing the flow
  PRIVACY_POLICY_URL: z.string().url().optional(),
});

let cached: z.infer<typeof schema> | null = null;

export function env() {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
