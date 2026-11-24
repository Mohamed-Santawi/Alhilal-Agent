import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { issueFormToken, peekFormToken } from "@/lib/forms/tokens";
import { acceptQuote } from "@/lib/bot/quotes";
import { setState, type Conversation, type Customer } from "@/lib/bot/repo";
import { getQuote } from "@/lib/shipping/repo";

export const runtime = "nodejs";

/** "إكمال الطلب" from the calculator page. Registered → accept now; otherwise → registration form, then auto-accept. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const tok = await peekFormToken(String(body.token ?? ""), "quote");
  if (!tok) return NextResponse.json({ error: "expired" }, { status: 410 });

  const q = await getQuote(String(body.quote_id ?? ""));
  if (!q || q.customer_id !== tok.customer_id) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [cust, conv] = await Promise.all([
    db().from("customers").select("*").eq("id", tok.customer_id).single(),
    db().from("conversations").select("*").eq("customer_id", tok.customer_id).single(),
  ]);
  if (cust.error || conv.error) return NextResponse.json({ error: "server" }, { status: 500 });
  const customer = cust.data as Customer;
  const c = conv.data as Conversation;

  if (customer.registration_complete) {
    await acceptQuote(customer, c, q.id);
    return NextResponse.json({ status: "accepted", code: q.code });
  }

  // Remember the quote; after registration (any path) onRegistered() accepts it.
  c.state = { ...c.state, pending_quote: q.id };
  await setState(c.id, c.state);
  const regToken = await issueFormToken(customer.id, "register", 60);
  return NextResponse.json({ status: "register", url: `/register?t=${regToken}` });
}
