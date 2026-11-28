import { db } from "../supabase";
import { wa } from "../whatsapp/send";

// 17 service rows > WhatsApp's 10-row limit → two levels: groups first, then services.
export const GROUPS = {
  sourcing:            { title: "التوريد والفحص",        desc: "تسعيرة، مصانع، توريد متكامل، فحص، دراسة خط إنتاج" },
  shipping_compliance: { title: "الشحن والامتثال",       desc: "شحن جزئي وحاويات، سابر، هيئة الغذاء والدواء، تخليص" },
  legal:               { title: "الخدمات القانونية",     desc: "استشارة، عقود، لائحة استئناف، مذكرة دفاع، ناجز" },
} as const;
export type GroupKey = keyof typeof GROUPS;

export const MENU_IDS = {
  group: (g: GroupKey) => `grp:${g}`,
  service: (key: string) => `svc:${key}`,
  quote: "act:quote",
  myOrders: "act:my_orders",
  human: "act:human",
  menu: "act:menu",
  order: (orderId: string) => `order:${orderId}`,
};

export async function sendMainMenu(to: string, greeting: string) {
  return wa.list(to, greeting, "اختر الخدمة", [
    {
      title: "الخدمات",
      rows: [
        { id: MENU_IDS.quote, title: "حاسبة أسعار الشحن", description: "اعرف سعر شحنتك فوراً دون تسجيل" },
        ...(Object.keys(GROUPS) as GroupKey[]).map((g) => ({
          id: MENU_IDS.group(g), title: GROUPS[g].title, description: GROUPS[g].desc,
        })),
      ],
    },
    {
      title: "حسابي",
      rows: [
        { id: MENU_IDS.myOrders, title: "طلباتي", description: "الطلبات والفواتير والشحنات" },
        { id: MENU_IDS.human, title: "التحدث مع موظف" },
      ],
    },
  ]);
}

function priceLabel(s: { pricing: string; base_price: number | null; percentage: number | null }) {
  if (s.pricing === "fixed") return `${Number(s.base_price).toLocaleString("en")} ريال + الضريبة`;
  if (s.pricing === "percentage") return `${s.percentage}% من قيمة التوريد`;
  return "السعر حسب الطلب";
}

export async function sendGroupMenu(to: string, group: GroupKey) {
  const r = await db()
    .from("services")
    .select("key,name_ar,pricing,base_price,percentage")
    .eq("menu_group", group).eq("active", true)
    .order("sort_order");
  if (r.error) throw r.error;
  return wa.list(to, `خدمات ${GROUPS[group].title}:`, "عرض الخدمات", [
    { title: GROUPS[group].title, rows: r.data.map((s) => ({ id: MENU_IDS.service(s.key), title: s.name_ar, description: priceLabel(s) })) },
  ]);
}
