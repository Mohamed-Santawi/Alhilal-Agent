"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/supabase";
import { assertStaff, PRICING_ROLES } from "@/lib/auth/staff";
import { authClient } from "@/lib/auth/supabase-server";

export type ActionResult = { ok: boolean; msg: string } | null;

const now = () => new Date().toISOString();
const money = z.preprocess((v) => String(v ?? "").replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/,/g, "").trim(), z.coerce.number().min(0).max(10_000_000));
const dateToIso = (d: string, endOfDay = false) => (d ? new Date(`${d}T${endOfDay ? "23:59:59" : "00:00:00"}+03:00`).toISOString() : null);

async function guard() {
  return assertStaff(PRICING_ROLES);
}
async function audit(actor: string, action: string, entity: string, entityId: string, data: unknown) {
  await db().from("audit_log").insert({ actor, action, entity, entity_id: entityId, data });
}
const done = (msg: string): ActionResult => { revalidatePath("/admin/pricing"); return { ok: true, msg }; };
const fail = (msg: string): ActionResult => ({ ok: false, msg });

async function run(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try { return await fn(); }
  catch (e) { console.error("[admin]", e); return fail(e instanceof Error && e.message.startsWith("غير مصرح") ? e.message : "حدثت مشكلة أثناء الحفظ"); }
}

// ---------------------------------------------------------------- shipping rates (air / LCL) — one table
/**
 * Saves the whole rates table at once. Fields:
 *   min_qty_air, min_qty_sea                      (global minimums, applied to every category)
 *   name_<key>, hint_<key>, active_<key>          (category info)
 *   price_<key>_air, price_<key>_sea              (empty = this mode is not offered for this category)
 * Only changed prices create a new version; old prices are closed, never deleted.
 */
export async function saveRatesTable(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const me = await guard();
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    const minQ = { air: money.safeParse(get("min_qty_air")), sea: money.safeParse(get("min_qty_sea")) };
    if (!minQ.air.success || !minQ.sea.success) return fail("الحد الأدنى غير صحيح");
    const minQty = { air: minQ.air.data, sea: minQ.sea.data };

    const t = now();
    const [cats, rates] = await Promise.all([
      db().from("shipping_categories").select("*"),
      db().from("shipping_rates").select("*").lte("effective_from", t).or(`effective_to.is.null,effective_to.gt.${t}`),
    ]);
    if (cats.error) throw cats.error;
    if (rates.error) throw rates.error;

    let changes = 0;
    for (const c of cats.data) {
      if (fd.get(`name_${c.key}`) === null) continue; // row not in the form

      // 1. category info
      const name_ar = get(`name_${c.key}`), hint_ar = get(`hint_${c.key}`) || null, active = fd.get(`active_${c.key}`) === "on";
      if (name_ar.length < 2) return fail("يوجد نوع بضاعة بدون اسم");
      if (name_ar !== c.name_ar || hint_ar !== c.hint_ar || active !== c.active) {
        await db().from("shipping_categories").update({ name_ar, hint_ar, active }).eq("key", c.key);
        await audit(me.id, "category.updated", "shipping_categories", c.key, { name_ar, hint_ar, active });
        changes++;
      }

      // 2. prices
      for (const mode of ["air", "sea"] as const) {
        const raw = get(`price_${c.key}_${mode}`);
        const cur = rates.data.find((r) => r.category_key === c.key && r.mode === mode);
        if (!raw) {
          if (cur) {
            await db().from("shipping_rates").update({ effective_to: t }).eq("id", cur.id);
            await audit(me.id, "rate.disabled", "shipping_rates", `${c.key}:${mode}`, { category: name_ar, mode });
            changes++;
          }
          continue;
        }
        const price = money.safeParse(raw);
        if (!price.success || price.data <= 0) return fail(`سعر غير صحيح: ${name_ar}`);
        if (cur && Number(cur.unit_price) === price.data && Number(cur.min_qty) === minQty[mode]) continue;

        if (cur) await db().from("shipping_rates").update({ effective_to: t }).eq("id", cur.id);
        const ins = await db().from("shipping_rates").insert({
          category_key: c.key, mode, unit_price: price.data, min_qty: minQty[mode],
          min_charge: cur ? Number(cur.min_charge) : 0, effective_from: t, created_by: me.id,
        }).select("id").single();
        if (ins.error) throw ins.error;
        await audit(me.id, "rate.changed", "shipping_rates", ins.data.id, {
          category: name_ar, mode,
          before: cur ? { unit_price: cur.unit_price, min_qty: cur.min_qty } : null,
          after: { unit_price: price.data, min_qty: minQty[mode] },
        });
        changes++;
      }
    }
    return changes ? done(`تم حفظ ${changes} تغيير ✓`) : fail("لا يوجد تغيير");
  });
}

// ---------------------------------------------------------------- FCL containers
export async function updateFclPrice(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const me = await guard();
    const key = String(fd.get("container_key") ?? "");
    const raw = String(fd.get("price") ?? "").trim();
    const t = now();
    const cur = await db().from("fcl_rates").select("*").eq("container_key", key).lte("effective_from", t)
      .or(`effective_to.is.null,effective_to.gt.${t}`).order("effective_from", { ascending: false }).limit(1).maybeSingle();

    if (!raw) { // empty = "price on request"
      if (!cur.data) return fail("لا يوجد تغيير");
      await db().from("fcl_rates").update({ effective_to: t }).eq("id", cur.data.id);
      await audit(me.id, "fcl.price_removed", "fcl_rates", key, { before: cur.data.price });
      return done("أصبحت الحاوية «السعر عند الطلب» ✓");
    }
    const p = money.safeParse(raw);
    if (!p.success || p.data <= 0) return fail("السعر غير صحيح");
    if (cur.data && Number(cur.data.price) === p.data) return fail("لا يوجد تغيير");
    if (cur.data) await db().from("fcl_rates").update({ effective_to: t }).eq("id", cur.data.id);
    const ins = await db().from("fcl_rates").insert({ container_key: key, price: p.data, effective_from: t, created_by: me.id }).select("id").single();
    if (ins.error) throw ins.error;
    await audit(me.id, "fcl.price_changed", "fcl_rates", ins.data.id, { container: key, before: cur.data?.price ?? null, after: p.data });
    return done("تم حفظ السعر ✓");
  });
}

// ---------------------------------------------------------------- categories
export async function saveCategory(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const me = await guard();
    const name_ar = String(fd.get("name_ar") ?? "").trim();
    const hint_ar = String(fd.get("hint_ar") ?? "").trim() || null;
    const active = fd.get("active") === "on";
    const key = String(fd.get("key") ?? "");
    if (name_ar.length < 2) return fail("يرجى كتابة اسم النوع");
    if (key) {
      const r = await db().from("shipping_categories").update({ name_ar, hint_ar, active }).eq("key", key);
      if (r.error) throw r.error;
      await audit(me.id, "category.updated", "shipping_categories", key, { name_ar, hint_ar, active });
      return done("تم الحفظ ✓");
    }
    const newKey = `cat_${Date.now().toString(36)}`;
    const max = await db().from("shipping_categories").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const r = await db().from("shipping_categories").insert({ key: newKey, name_ar, hint_ar, active: true, sort_order: (max.data?.sort_order ?? 0) + 1 });
    if (r.error) throw r.error;
    await audit(me.id, "category.created", "shipping_categories", newKey, { name_ar, hint_ar });
    return done("تمت إضافة النوع ✓ — أدخل أسعاره في الجدول");
  });
}

// ---------------------------------------------------------------- surcharges
export async function addSurcharge(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const me = await guard();
    const p = z.object({
      name_ar: z.string().trim().min(2),
      mode: z.enum(["", "sea", "air"]),
      kind: z.enum(["percent", "fixed"]),
      amount: money,
      starts_at: z.string(),
      ends_at: z.string(),
    }).safeParse(Object.fromEntries(fd));
    if (!p.success) return fail("يرجى مراجعة البيانات");
    const d = p.data;
    if (d.amount <= 0) return fail("يجب أن تكون القيمة أكبر من صفر");
    if (d.kind === "percent" && d.amount > 100) return fail("يجب أن تكون النسبة أقل من 100%");
    const row = {
      name_ar: d.name_ar, mode: d.mode || null, kind: d.kind, amount: d.amount,
      starts_at: dateToIso(d.starts_at) ?? now(), ends_at: dateToIso(d.ends_at, true), active: true,
    };
    const ins = await db().from("shipping_surcharges").insert(row).select("id").single();
    if (ins.error) throw ins.error;
    await audit(me.id, "surcharge.created", "shipping_surcharges", ins.data.id, row);
    return done("تمت إضافة الرسوم ✓");
  });
}

export async function toggleSurcharge(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const me = await guard();
    const id = String(fd.get("id")), active = fd.get("active") === "true";
    const r = await db().from("shipping_surcharges").update({ active }).eq("id", id);
    if (r.error) throw r.error;
    await audit(me.id, active ? "surcharge.enabled" : "surcharge.disabled", "shipping_surcharges", id, { active });
    return done(active ? "تم التشغيل ✓" : "تم الإيقاف ✓");
  });
}

export async function deleteSurcharge(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const me = await guard();
    const id = String(fd.get("id"));
    const old = await db().from("shipping_surcharges").select("*").eq("id", id).single();
    const r = await db().from("shipping_surcharges").delete().eq("id", id);
    if (r.error) throw r.error;
    await audit(me.id, "surcharge.deleted", "shipping_surcharges", id, old.data);
    return done("تم الحذف ✓");
  });
}

// ---------------------------------------------------------------- other services
export async function updateService(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const me = await guard();
    const key = String(fd.get("key"));
    const cur = await db().from("services").select("*").eq("key", key).single();
    if (cur.error) throw cur.error;
    const active = fd.get("active") === "on";
    const patch: Record<string, unknown> = { active };
    if (cur.data.pricing === "fixed") {
      const p = money.safeParse(fd.get("base_price"));
      if (!p.success || p.data <= 0) return fail("السعر غير صحيح");
      patch.base_price = p.data;
    }
    if (cur.data.pricing === "percentage") {
      const p = money.safeParse(fd.get("percentage"));
      if (!p.success || p.data <= 0 || p.data > 100) return fail("النسبة غير صحيحة");
      patch.percentage = p.data;
    }
    const r = await db().from("services").update(patch).eq("key", key);
    if (r.error) throw r.error;
    await audit(me.id, "service.updated", "services", key, {
      before: { base_price: cur.data.base_price, percentage: cur.data.percentage, active: cur.data.active }, after: patch,
    });
    return done("تم الحفظ ✓");
  });
}

// ---------------------------------------------------------------- settings
export async function updateSettings(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const me = await guard();
    const p = z.object({
      vat_rate: money.pipe(z.number().max(100)),
      quote_validity_days: money.pipe(z.number().int().min(1).max(90)),
      air_volumetric_divisor: money.pipe(z.number().int().min(1000).max(10000)),
    }).safeParse(Object.fromEntries(fd));
    if (!p.success) return fail("يرجى مراجعة القيم (الصلاحية من 1 إلى 90 يوماً، والمعامل من 1000 إلى 10000)");
    const row = { ...p.data, prices_are_samples: fd.get("prices_are_samples") === "on", updated_at: now() };
    const r = await db().from("shipping_settings").update(row).eq("id", 1);
    if (r.error) throw r.error;
    await audit(me.id, "settings.updated", "shipping_settings", "1", row);
    return done("تم حفظ الإعدادات ✓");
  });
}

// ---------------------------------------------------------------- session
export async function signOut() {
  const supa = await authClient();
  await supa.auth.signOut();
  redirect("/admin/login");
}
