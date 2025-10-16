import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const DEFAULT_ADMIN = {
  email: "admin@ticketflow.local",
  password: "Admin123!",
  firstName: "System",
  lastName: "Administrator",
  role: "admin" as const,
};

export async function seedDefaultAdmin() {
  try {
    console.log("Checking for default admin user...");
    
    // Check if admin user already exists
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, DEFAULT_ADMIN.email))
      .limit(1);
    
    if (existing.length === 0) {
      // Hash the password
      const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN.password, 12);
      
      // Create default admin user
      await db.insert(users).values({
        id: randomUUID(),
        email: DEFAULT_ADMIN.email,
        password: hashedPassword,
        firstName: DEFAULT_ADMIN.firstName,
        lastName: DEFAULT_ADMIN.lastName,
        role: DEFAULT_ADMIN.role,
        isActive: true,
        isApproved: true,
      });
      
      console.log("✓ Default admin user created successfully!");
      console.log("  Email: admin@ticketflow.local");
      console.log("  Password: Admin123!");
    } else {
      console.log("Default admin user already exists.");
    }
  } catch (error) {
    console.error("Error seeding default admin:", error);
    throw error;
  }
}
