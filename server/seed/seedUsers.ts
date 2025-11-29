import { db } from "../storage/db";
import { users } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { scrypt, randomBytes, randomUUID } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

const DEFAULT_ADMIN = {
  email: "admin@ticketflow.local",
  password: "Admin123!",
  firstName: "System",
  lastName: "Administrator",
  role: "admin" as const,
};

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function seedUsers() {
  try {
    console.log("Checking for default admin user...");

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, DEFAULT_ADMIN.email))
      .limit(1);

    if (existing.length === 0) {
      const hashedPassword = await hashPassword(DEFAULT_ADMIN.password);

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

    const DUMMY_USERS: Array<{
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      role: "manager" | "agent" | "customer";
    }> = [
      {
        email: "manager@ticketflow.local",
        password: "Password123!",
        firstName: "Default",
        lastName: "Manager",
        role: "manager",
      },
      {
        email: "agent@ticketflow.local",
        password: "Password123!",
        firstName: "Default",
        lastName: "Agent",
        role: "agent",
      },

      {
        email: "customer@ticketflow.local",
        password: "Password123!",
        firstName: "Default",
        lastName: "Customer",
        role: "customer",
      },
    ];

    // Create 3 users per role with role prefix in name
    const EXTRA_ROLES: Array<"admin" | "manager" | "agent" | "customer"> = [
      "admin",
      "manager",
      "agent",
      "customer",
    ];

    for (const role of EXTRA_ROLES) {
      for (let i = 1; i <= 3; i++) {
        const email = `${role}${i}@ticketflow.local`;
        const exists = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (exists.length === 0) {
          const hashed = await hashPassword("Password123!");
          await db.insert(users).values({
            id: randomUUID(),
            email,
            password: hashed,
            firstName: `(${role.charAt(0).toUpperCase() + role.slice(1)})`,
            lastName: i === 1 ? "Taylor" : i === 2 ? "Jordan" : "Morgan",
            role: role as any,
            isActive: true,
            isApproved: true,
          });
          console.log(`✓ Created ${role} user: ${email}`);
        }
      }
    }

    for (const dummy of DUMMY_USERS) {
      const exists = await db
        .select()
        .from(users)
        .where(eq(users.email, dummy.email))
        .limit(1);

      if (exists.length === 0) {
        const hashed = await hashPassword(dummy.password);
        await db.insert(users).values({
          id: randomUUID(),
          email: dummy.email,
          password: hashed,
          firstName: dummy.firstName,
          lastName: dummy.lastName,
          role: dummy.role,
          isActive: true,
          isApproved: true,
        });
        console.log(`✓ Created ${dummy.role} user: ${dummy.email}`);
      } else {
        console.log(`User already exists: ${dummy.email}`);
      }
    }
  } catch (error) {
    console.error("Error seeding default users:", error);
    throw error;
  }
}
