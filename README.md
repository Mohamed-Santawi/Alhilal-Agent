# Hilal Alsharq — WhatsApp AI Agent

## Step 1 status
- [x] Next.js 15 + TypeScript scaffold (RTL Arabic)
- [x] Supabase schema `supabase/migrations/0001_init.sql` (customers, addresses, conversations, messages, services + prices, staff, orders, spec versions, attachments, payments, tasks, audit)
- [x] WhatsApp webhook `/api/webhooks/whatsapp` — verify token, HMAC signature check, dedupe by `wa_message_id`, async processing via `after()`
- [x] Customer auto-creation with permanent code `HA-000001`
- [x] Two-level service menu (WhatsApp list limit = 10 rows)

## Setup

### 1. Supabase
1. Create a project at supabase.com (region: closest to KSA, e.g. Frankfurt or Mumbai).
2. SQL Editor → paste and run `supabase/migrations/0001_init.sql`.
3. Settings → API → copy `Project URL` and `service_role` key into `.env.local`.

### 2. Meta / WhatsApp Cloud API
1. developers.facebook.com → Create App → type **Business** → add **WhatsApp**.
2. API Setup: copy **Phone number ID**, add your phone as a test recipient.
3. Business Settings → System Users → create one (Admin) → generate a **permanent token** with
   `whatsapp_business_messaging`, `whatsapp_business_management`.
4. App Settings → Basic → copy **App Secret**.

### 3. Run locally
```bash
cp .env.example .env.local   # fill the values
npm install
npm run dev
npx ngrok http 3000          # or cloudflared tunnel
```
WhatsApp → Configuration → Webhook:
- Callback URL: `https://<ngrok-url>/api/webhooks/whatsapp`
- Verify token: same as `WHATSAPP_VERIFY_TOKEN`
- Subscribe to the **messages** field.

### 4. Test
Send any message to the test number → you get a welcome message with your `HA-xxxxxx` code and the menu.
Check the `customers`, `conversations`, and `messages` tables in Supabase.

## Design rules (don't break these)
- Prices live in the `services` table, never in prompts.
- An order is `paid` ONLY after the verified gateway webhook (`payments.gateway_ref` is unique).
- Supplier prices never enter the LLM context.
- All money math (VAT, credits, volumetric weight) is code, not LLM.
