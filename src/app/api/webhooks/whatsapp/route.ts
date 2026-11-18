import { NextResponse, after, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { verifyWhatsAppSignature } from "@/lib/whatsapp/verify";
import { extractInbound, type WaWebhookBody } from "@/lib/whatsapp/types";
import { handleIncoming } from "@/lib/bot/handle-incoming";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Meta webhook verification (one-time, when you save the callback URL). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === env().WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(p.get("hub.challenge"), { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/** Inbound messages. Reply 200 fast, process after the response (Meta retries slow webhooks). */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyWhatsAppSignature(raw, req.headers.get("x-hub-signature-256"), env().WHATSAPP_APP_SECRET)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const messages = extractInbound(JSON.parse(raw) as WaWebhookBody);

  after(async () => {
    for (const m of messages) {
      try {
        await handleIncoming(m);
      } catch (err) {
        console.error("[whatsapp] failed to handle", m.waMessageId, err);
      }
    }
  });

  return NextResponse.json({ ok: true });
}
