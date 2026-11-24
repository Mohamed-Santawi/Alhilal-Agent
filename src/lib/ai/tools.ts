import { db } from "../supabase";
import { getShippingSettings, listCategoryOptions, listContainerOptions, listMainCities } from "../shipping/repo";
import { createAndSendQuote } from "../shipping/quote-service";
import { FCL_SERVICES, PORTS } from "../shipping/pricing";
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
      description: "معلومات الشحن الحالية: أنواع البضاعة (key) وطرق الشحن المتاحة لكل نوع، أسعار الوحدة، الحدود الدنيا، مدة الوصول، المدن الرئيسية ورسوم المناطق النائية، أنواع الحاويات وموانئ الوصول. استخدمها قبل estimate_shipping وللإجابة عن أسئلة المدة والتوصيل.",
      parameters: obj({}),
    },
  },
  {
    type: "function",
    function: {
      name: "estimate_shipping",
      description: "للشحن الجوي (air) أو البحري الجزئي (lcl) فقط: يحسب تسعيرة مبدئية بمحرك الأسعار الرسمي، ويحفظها، ويرسلها للعميل على واتساب مع زر «إكمال الطلب». الحاويات الكاملة لا تُسعّر هنا (أرسل send_calculator_link).",
      parameters: obj({
        kind: { type: "string", enum: ["air", "lcl"] },
        city: { type: "string", description: "مدينة التوصيل في السعودية" },
        items: {
          type: "array",
          description: "منتج لكل سطر؛ الشحنة قد تحتوي أكثر من منتج",
          items: obj({
            category_key: { type: "string", description: "key نوع البضاعة من get_shipping_options" },
            product: { type: "string", description: "اسم المنتج كما ذكره العميل" },
            cartons: {
              type: "array",
              description: "سطر لكل مقاس كرتونة",
              items: obj({
                qty: { type: "integer", description: "عدد الكراتين بهذا المقاس" },
                l: { type: "number", description: "الطول بالسنتيمتر" },
                w: { type: "number", description: "العرض بالسنتيمتر" },
                h: { type: "number", description: "الارتفاع بالسنتيمتر" },
                kg: { type: "number", description: "وزن الكرتونة الواحدة بالكيلو" },
              }, ["qty", "l", "w", "h", "kg"]),
            },
          }, ["category_key", "product", "cartons"]),
        },
      }, ["kind", "city", "items"]),
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
    function: {
      name: "send_main_menu",
      description: "يرسل قائمة الخدمات التفاعلية مع نص قصير فوقها، وينهي ردك (لا يُرسل بعدها أي نص). استخدمها للترحيب بالتحية.",
      parameters: obj({ text: { type: "string", description: "نص قصير يظهر فوق القائمة، مثل: أهلاً بك في هلال الشرق، كيف يمكننا مساعدتك؟" } }),
    },
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
      const [cats, containers, cities, settings, rates] = await Promise.all([
        listCategoryOptions(),
        listContainerOptions(),
        listMainCities(),
        getShippingSettings(),
        db().from("shipping_rates").select("category_key, mode, unit_price, min_qty").lte("effective_from", t).or(`effective_to.is.null,effective_to.gt.${t}`),
      ]);
      return {
        categories: cats.map((c) => ({
          key: c.key, name: c.name_ar, includes: c.hint_ar, kinds: c.kinds.filter((k) => k !== "fcl"),
          air_price_per_kg: n(rates.data?.find((r) => r.category_key === c.key && r.mode === "air")?.unit_price) || null,
          lcl_price_per_cbm: n(rates.data?.find((r) => r.category_key === c.key && r.mode === "sea")?.unit_price) || null,
        })),
        minimums: {
          air_kg: n(rates.data?.find((r) => r.mode === "air")?.min_qty) || null,
          lcl_cbm: n(rates.data?.find((r) => r.mode === "sea")?.min_qty) || null,
        },
        air_rule: `الأعلى بين الوزن الفعلي والوزن الحجمي (الطول×العرض×الارتفاع سم ÷ ${settings.air_volumetric_divisor})`,
        includes: "الجوي والبحري الجزئي LCL: السعر شامل التخليص والتوصيل من مستودعنا في الصين إلى باب العميل",
        mixed_shipment_pricing: settings.mixed_pricing === "highest" ? "الشحنة التي فيها أكثر من نوع تُحسب كلها بسعر النوع الأعلى" : "كل منتج يُحسب بسعر نوعه",
        transit: { air: settings.transit_air_ar, sea: settings.transit_sea_ar, note: settings.customs_notice_ar },
        delivery: cities.length
          ? { main_cities: cities, remote_fee_per_carton_sar: settings.remote_fee_per_carton ?? "يحدده الفريق", rule: "أي مدينة خارج القائمة تُعتبر نائية" }
          : { rule: "لا توجد رسوم إضافية للمدن حالياً" },
        full_containers: {
          types: containers.map((c) => ({ key: c.key, name: c.name_ar, note: c.hint_ar })),
          ports: PORTS.map((p) => p.name_ar),
          services: FCL_SERVICES.map((x) => x.name_ar),
          how: "لا يوجد سعر فوري للحاوية الكاملة: يعبّئ العميل طلب الحاوية من الحاسبة (المنتجات بالصور، ميناء الوصول، المدينة، عنوان المصنع في الصين، الخدمات) ويرد الفريق خلال 24 ساعة",
        },
        currency: "SAR, before 15% VAT",
      };
    }

    case "estimate_shipping": {
      const kind = String(args.kind ?? "");
      if (kind !== "air" && kind !== "lcl") return { error: "الحاويات الكاملة تُطلب من الحاسبة: أرسل send_calculator_link" };
      const items = Array.isArray(args.items) ? (args.items as Record<string, unknown>[]) : [];
      const r = await createAndSendQuote({
        customerId: customer.id,
        kind,
        city: String(args.city ?? ""),
        items: items.map((i) => ({ category: String(i.category_key ?? ""), product: String(i.product ?? ""), cartons: (i.cartons as never) ?? [] })),
      });
      if (!r.ok) return { error: r.error };
      ctx.sent = true;
      return {
        sent_to_customer: true,
        quote_code: r.quote.code,
        total_sar_incl_vat: r.b.total,
        chargeable: `${r.b.chargeable} ${r.b.unit}`,
        min_applied: r.b.min_qty_applied,
        remote_city: r.b.remote.is_remote,
        prices_are_samples: r.samples,
        note: "التسعيرة الكاملة (مع مدة الوصول) وصلت العميل مع زر «إكمال الطلب». علّق بسطر واحد فقط.",
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
    {
      const text = String(args.text ?? "").trim().slice(0, 300) || "أهلاً بك في هلال الشرق 🌙\nكيف يمكننا مساعدتك؟ اختر من القائمة 👇";
      await sendMainMenu(customer.wa_id, text);
      await logOutbound(conv.id, undefined, "interactive", `${text}\n[القائمة الرئيسية]`);
      ctx.sent = true;
      ctx.stop = true; // the menu is the whole reply
      return { sent: true };
    }

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
