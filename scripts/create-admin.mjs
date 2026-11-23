// Creates (or updates) an admin login and links it to the staff table.
//
//   node --env-file=.env.local scripts/create-admin.mjs <email> <password> "<full name>" [role]
//
// role: admin (default) | finance | sales | china_team | legal | support
// Running it again for the same email resets the password and keeps one staff row.

import { createClient } from "@supabase/supabase-js";

const [email, password, fullName = "المدير", role = "admin"] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node --env-file=.env.local scripts/create-admin.mjs <email> <password> "<full name>" [role]');
  process.exit(1);
}
if (password.length < 8) { console.error("Password must be at least 8 characters."); process.exit(1); }

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const mail = email.trim().toLowerCase();

// 1) Auth user: create, or reset the password if it already exists
let userId;
const created = await db.auth.admin.createUser({ email: mail, password, email_confirm: true });
if (created.error) {
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const existing = data.users.find((u) => u.email?.toLowerCase() === mail);
  if (!existing) throw created.error;
  const upd = await db.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
  if (upd.error) throw upd.error;
  userId = existing.id;
  console.log("✔ Login already existed — password updated");
} else {
  userId = created.data.user.id;
  console.log("✔ Login created");
}

// 2) Staff row with the role
const staff = await db.from("staff").upsert(
  { auth_user_id: userId, email: mail, full_name: fullName, role, active: true },
  { onConflict: "email" },
).select("id, email, role").single();
if (staff.error) throw staff.error;
console.log(`✔ Staff: ${staff.data.email} — role: ${staff.data.role}`);
console.log("Done. Log in at /admin/login");
