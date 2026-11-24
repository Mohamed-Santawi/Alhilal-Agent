import { db } from "../supabase";
import { listCategoryOptions, listContainerOptions } from "../shipping/repo";
import { createAndSendQuote } from "../shipping/quote-service";
import type { Kind } from "../shipping/pricing";
import { sendMainMenu } from "../bot/menu";
import { requestService, sendQuoteLink } from "../bot/quotes";
import { startRegistration } from "../bot/registration-chat";
import { handoffToHuman } from "../bot/handoff";
import { logOutbound, setState, type Conversation, type Customer } from "../bot/repo";
import type { ToolDef } from "./openrouter";

export type ToolCtx = { customer: Customer; conv: Conversation; sent: boolean; stop: boolean };

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

export const TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "get_shipping_options",
      description: "أنواع البضاعة المتاحة للشحن (key واسم ووصف وطرق الشحن المتاحة لكل نوع: air / lcl / fcl)، وأسعار الوحدة، والحد الأدنى، وأنواع الحاويات الكاملة وأسعارها. استخدمها قبل estimate_shipping لمعرفة category_key الصحيح.",
      parameters: obj({}),
    },
  },
  {
    type: "function",
    function: {
      name: "estimate_shipping",
      description: "يحسب تسعيرة شحن مبدئية بمحرك الأسعار الرسمي، ويحفظها، ويرسلها للعميل على واتساب مع زر «إكمال الطلب». للجوي وLCL مرّر cartons، وللحاويات الكاملة مرّر containers.",
      parameters: obj({
        category_key: { type: "string", description: "key نوع البضاعة من get_shipping_options" },
        kind: { type: "string", enum: ["air", "lcl", "fcl"] },
        cartons: {
          type: "array",
          description: "سطر لكل مقاس كرتونة (air / lcl)",
          items: obj({
            qty: { type: "integer", description: "عدد الكراتين بهذا المقاس" },
            l: { type: "number", description: "الطول بالسنتيمتر" },
            w: { type: "number", description: "العرض بالسنتيمتر" },
            h: { type: "number", description: "الارتفاع بالسنتيمتر" },
            kg: { type: "number", description: "وزن الكرتونة الواحدة بالكيلو" },
          }, ["qty", "l", "w", "h", "kg"]),
        },
        containers: {
          type: "array",
          description: "للحاويات الكاملة (fcl) فقط",
          items: obj({ key: { type: "string", description: "key الحاوية من get_shipping_options" }, count: { type: "integer" } }, ["key", "count"]),
        },
      }, ["category_key", "kind"]),
    },
  },
  {
    type: "function",
    function: { name: "list_services", description: "قائمة خدمات الشركة (غير الشحن) وأسعارها الحالية.", parameters: obj({}) },
  },
  {
    type: "function",
    function: { name: "send_calculator_link", description: "يرسل للعميل رابط حاسبة أسعار الشحن (نموذج يدخل فيه الكراتين بنفسه).", parameters: obj({}) },
  },
  {
    type: "function",
    function: { name: "send_main_menu", description: "يرسل قائمة الخدمات التفاعلية.", parameters: obj({}) },
  },
  {
    type: "function",
    function: {
      name: "start_registration",
      description: "عندما يقرر العميل بدء طلب خدمة (غير الشحن): إن كان مسجّلاً يُفتح طلب للفريق مباشرة، وإن لم يكن مسجّلاً يبدأ تسجيل بياناته ثم يُفتح الطلب تلقائياً.",
      parameters: obj({ service_name: { type: "string", description: "اسم الخدمة التي يريد بدءها" } }, ["service_name"]),
    },
  },
  {
    type: "function",
    function: { name: "get_my_account", description: "بيانات العميل الحالي: رقم العميل، حالة التسجيل، وآخر تسعيرات الشحن وحالتها.", parameters: obj({}) },
  },
  {
    type: "function",
    function: {
      name: "handoff_to_human",
      description: "يحوّل المحادثة لموظف خدمة العملاء ويوقف الرد الآلي مؤقتاً.",
      parameters: obj({ reason: { type: "string", description: "سبب التحويل باختصار، يظهر للموظف" } }, ["reason"]),
    },
  },
];

const n = (v: unknown) => Number(v ?? 0);

export async function runTool(name: string, rawArgs: string, ctx: ToolCtx): Promise<unknown> {
  let args: Record<string, unknown> = {};
  try { args = rawArgs ? JSON.parse(rawArgs) : {}; } catch { return { error: "invalid JSON arguments" }; }
  const { customer, conv } = ctx;

  switch (name) {
    case "get_shipping_options": {
      const t = new Date().toISOString();
      const [cats, containers, rates] = await Promise.all([
        listCategoryOptions(),
        listContainerOptions(),
        db().from("shipping_rates").select("category_key, mode, unit_price, min_qty").lte("effective_from", t).or(`effective_to.is.null,effective_to.gt.${t}`),
      ]);
      return {
        categories: cats.map((c) => ({
          key: c.key, name: c.name_ar, includes: c.hint_ar, kinds: c.kinds,
          air_price_per_kg: n(rates.data?.find((r) => r.category_key === c.key && r.mode === "air")?.unit_price) || null,
          lcl_price_per_cbm: n(rates.data?.find((r) => r.category_key === c.key && r.mode === "sea")?.unit_price) || null,
        })),
        minimums: {
          air_kg: n(rates.data?.find((r) => r.mode === "air")?.min_qty) || null,
          lcl_cbm: n(rates.data?.find((r) => r.mode === "sea")?.min_qty) || null,
        },
        containers: containers.map((c) => ({ key: c.key, name: c.name_ar, note: c.hint_ar, price_per_container: c.price ?? "عند الطلب" })),
        currency: "SAR, before 15% VAT",
      };
    }

    case "estimate_shipping": {
      const r = await createAndSendQuote({
        customerId: customer.id,
        category: String(args.category_key ?? ""),
        kind: String(args.kind ?? "") as Kind,
        cartons: (args.cartons as never) ?? [],
        containers: (args.containers as never) ?? [],
      });
      if (!r.ok) return { error: r.error };
      ctx.sent = true;
      return {
        sent_to_customer: true,
        quote_code: r.quote.code,
        total_sar_incl_vat: r.b.total,
        chargeable: `${r.b.chargeable} ${r.b.unit}`,
        min_applied: r.b.min_qty_applied,
        prices_are_samples: r.samples,
        note: "التسعيرة الكاملة وصلت العميل مع زر «إكمال الطلب». علّق بجملة قصيرة فقط.",
      };
    }

    case "list_services": {
      const r = await db().from("services").select("name_ar, pricing, base_price, percentage, menu_group").eq("active", true).order("menu_group").order("sort_order");
      return (r.data ?? []).map((s) => ({
        name: s.name_ar,
        price: s.pricing === "fixed" ? `${n(s.base_price)} ريال + الضريبة` : s.pricing === "percentage" ? `${n(s.percentage)}% من قيمة التوريد` : "حسب الطلب (يسعّرها الفريق)",
      }));
    }

    case "send_calculator_link":
      await sendQuoteLink(customer, conv);
      ctx.sent = true;
      return { sent: true };

    case "send_main_menu":
      await sendMainMenu(customer.wa_id, "اختر الخدمة التي تحتاجها 👇");
      await logOutbound(conv.id, undefined, "interactive", "[القائمة الرئيسية]");
      ctx.sent = true;
      return { sent: true };

    case "start_registration":
    {
      const name = String(args.service_name ?? "خدمة");
      if (customer.registration_complete) {
        await requestService(customer, conv, "agent", name);
        ctx.sent = true;
        ctx.stop = true;
        return { service_request_created: true };
      }
      conv.state = { ...conv.state, pending_service: { key: "agent", name } };
      await setState(conv.id, conv.state);
      await startRegistration(customer, conv, `لبدء طلب *${String(args.service_name ?? "الخدمة")}*، نحتاج إلى تسجيل بياناتك مرة واحدة فقط.`);
      ctx.sent = true;
      ctx.stop = true; // registration owns the conversation now
      return { started: true };
    }

    case "get_my_account": {
      const q = await db().from("shipping_quotes").select("code, kind, total, status, valid_until, created_at")
        .eq("customer_id", customer.id).order("created_at", { ascending: false }).limit(5);
      return {
        code: customer.code, name: customer.full_name, registered: customer.registration_complete,
        recent_quotes: (q.data ?? []).map((x) => ({ code: x.code, kind: x.kind, total_sar: n(x.total), status: x.status, valid_until: x.valid_until })),
      };
    }

    case "handoff_to_human":
      await handoffToHuman(customer, conv, String(args.reason ?? "طلب العميل"));
      ctx.sent = true;
      ctx.stop = true;
      return { done: true };

    default:
      return { error: `unknown tool ${name}` };
  }
}
