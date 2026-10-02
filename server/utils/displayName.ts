import { sql, type SQL } from "drizzle-orm";

/**
 * The one rule for a person's display name in ticket responses: first and last
 * name, or whichever exists, else a neutral label by role. NEVER the email: a
 * display name reaches customers, and an email is contact data. The `users`
 * table has no display-name column.
 */
export function displayNameOf(
  u: { firstName?: string | null; lastName?: string | null; role?: string | null } | null | undefined
): string {
  const full = [u?.firstName, u?.lastName]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
    .join(" ");
  if (full) return full;
  return u?.role === "customer" ? "Customer" : "Support agent";
}

/** SQL twin of displayNameOf over three column references (a joined alias or the users table). */
export function displayNameSql(first: SQL | string, last: SQL | string, role: SQL | string): SQL {
  const raw = (v: SQL | string) => (typeof v === "string" ? sql.raw(v) : v);
  return sql`COALESCE(
    NULLIF(btrim(concat_ws(' ', NULLIF(btrim(${raw(first)}), ''), NULLIF(btrim(${raw(last)}), ''))), ''),
    CASE WHEN ${raw(role)} = 'customer' THEN 'Customer' ELSE 'Support agent' END
  )`;
}
