// Shared by the server (normalizing) and the browser form (dropdown) — keep it dependency-free.
export const REGIONS: Record<string, string> = {
  riyadh: "الرياض", makkah: "مكة المكرمة", madinah: "المدينة المنورة", eastern: "المنطقة الشرقية",
  qassim: "القصيم", asir: "عسير", tabuk: "تبوك", hail: "حائل", northern_borders: "الحدود الشمالية",
  jazan: "جازان", najran: "نجران", baha: "الباحة", jouf: "الجوف",
};
