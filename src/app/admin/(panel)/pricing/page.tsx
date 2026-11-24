import { requireStaff, PRICING_ROLES } from "@/lib/auth/staff";
import { db } from "@/lib/supabase";
import PricingView from "./PricingView";

export default async function PricingAdmin() {
  await requireStaff(PRICING_ROLES);
  const t = new Date().toISOString();
  const [cats, rates, cities, surcharges, services, settings, staff, log] = await Promise.all([
    db().from("shipping_categories").select("*").order("sort_order"),
    db().from("shipping_rates").select("*").lte("effective_from", t).or(`effective_to.is.null,effective_to.gt.${t}`).order("effective_from", { ascending: false }),
    db().from("shipping_cities").select("*").order("sort_order").order("name_ar"),
    db().from("shipping_surcharges").select("*").order("created_at", { ascending: false }),
    db().from("services").select("*").order("menu_group").order("sort_order"),
    db().from("shipping_settings").select("*").eq("id", 1).single(),
    db().from("staff").select("id, full_name"),
    db().from("audit_log").select("*").in("entity", ["shipping_rates", "shipping_cities", "shipping_categories", "shipping_surcharges", "services", "shipping_settings"])
      .order("created_at", { ascending: false }).limit(25),
  ]);
  return (
    <PricingView data={{
      t, cats: cats.data ?? [], rates: rates.data ?? [], cities: cities.data ?? [],
      surcharges: surcharges.data ?? [], services: services.data ?? [], settings: settings.data,
      staff: staff.data ?? [], log: log.data ?? [],
    }} />
  );
}
