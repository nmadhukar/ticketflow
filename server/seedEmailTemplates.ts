import { db } from "./db";
import { emailTemplates } from "@shared/schema";
import { defaultEmailTemplates } from "./emailTemplates";
import { eq } from "drizzle-orm";

export async function seedEmailTemplates() {
  try {
    console.log("Seeding email templates...");
    
    for (const template of defaultEmailTemplates) {
      // Check if template already exists
      const existing = await db
        .select()
        .from(emailTemplates)
        .where(eq(emailTemplates.name, template.name))
        .limit(1);
      
      if (existing.length === 0) {
        // Create new template
        await db.insert(emailTemplates).values({
          name: template.name,
          subject: template.subject,
          body: template.body,
          variables: template.variables,
          isActive: template.isActive,
        });
        console.log(`Created template: ${template.name}`);
      } else {
        console.log(`Template already exists: ${template.name}`);
      }
    }
    
    console.log("Email templates seeded successfully!");
  } catch (error) {
    console.error("Error seeding email templates:", error);
    throw error;
  }
}

// Run seed function if this file is executed directly
// Note: This pattern won't work with ES modules in TypeScript
// The seeding is handled automatically when the server starts