import { db } from "../db";
import { emailTemplates } from "@shared/schema";
import { defaultEmailTemplates } from "../emailTemplates";
import { eq } from "drizzle-orm";

export async function seedEmailTemplates(): Promise<void> {
  try {
    for (const tpl of defaultEmailTemplates) {
      const existing = await db
        .select({ name: emailTemplates.name })
        .from(emailTemplates)
        .where(eq(emailTemplates.name, tpl.name));
      if (existing.length === 0) {
        await db.insert(emailTemplates).values({
          name: tpl.name,
          subject: tpl.subject,
          body: tpl.body,
          variables: tpl.variables as any,
          isActive: tpl.isActive,
        });
      }
    }
    console.log("Email templates seeded.");
  } catch (err) {
    console.error("Failed to seed email templates:", err);
  }
}
