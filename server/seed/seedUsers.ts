import { db } from "../storage/db";
import { users, userInvitations } from "@shared/schema";
import { eq } from "drizzle-orm";
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

function generateInvitationToken(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

async function createInvitationForUser(
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  },
  invitedBy: string,
  daysAgo: number = 30
): Promise<void> {
  // Check if invitation already exists
  const existing = await db
    .select()
    .from(userInvitations)
    .where(eq(userInvitations.email, user.email))
    .limit(1);

  if (existing.length > 0) {
    return; // Invitation already exists
  }

  const createdAt = new Date();
  createdAt.setDate(createdAt.getDate() - daysAgo);
  const expiresAt = new Date(createdAt);
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days after creation
  const acceptedAt = new Date(createdAt);
  acceptedAt.setDate(acceptedAt.getDate() + 1); // Accepted 1 day after creation

  await db.insert(userInvitations).values({
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    invitedBy: invitedBy,
    invitationToken: generateInvitationToken(),
    status: "accepted",
    expiresAt: expiresAt,
    acceptedAt: acceptedAt,
    createdAt: createdAt,
  });
}

export async function seedUsers() {
  try {
    console.log("Checking for default admin user...");

    let adminUserId: string | undefined;

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, DEFAULT_ADMIN.email))
      .limit(1);

    if (existing.length === 0) {
      adminUserId = randomUUID();
      const hashedPassword = await hashPassword(DEFAULT_ADMIN.password);

      await db.insert(users).values({
        id: adminUserId,
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
      adminUserId = existing[0].id;
      console.log("Default admin user already exists.");
    }

    // Get admin user ID for invitations (use first admin if default doesn't exist)
    if (!adminUserId) {
      const [firstAdmin] = await db
        .select()
        .from(users)
        .where(eq(users.role, "admin"))
        .limit(1);
      adminUserId = firstAdmin?.id;
    }

    // If still no admin, use first user or create a system admin
    if (!adminUserId) {
      const [firstUser] = await db.select().from(users).limit(1);
      adminUserId = firstUser?.id || "system";
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
          const userId = randomUUID();
          const hashed = await hashPassword("Password123!");
          const firstName = `(${role.charAt(0).toUpperCase() + role.slice(1)})`;
          const lastName = i === 1 ? "Taylor" : i === 2 ? "Jordan" : "Morgan";

          await db.insert(users).values({
            id: userId,
            email,
            password: hashed,
            firstName,
            lastName,
            role: role as any,
            isActive: true,
            isApproved: true,
          });
          console.log(`✓ Created ${role} user: ${email}`);

          // Create invitation record for this user
          if (adminUserId) {
            await createInvitationForUser(
              {
                id: userId,
                email,
                firstName,
                lastName,
                role: role as any,
              },
              adminUserId,
              30 - i * 2 // Stagger invitation dates
            );
            console.log(`  ✓ Created invitation record for ${email}`);
          }
        } else {
          // User exists, check if invitation exists
          const user = exists[0];
          if (adminUserId) {
            await createInvitationForUser(
              {
                id: user.id,
                email: user.email || "",
                firstName: user.firstName || "",
                lastName: user.lastName || "",
                role: user.role,
              },
              adminUserId,
              30
            );
          }
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
        const userId = randomUUID();
        const hashed = await hashPassword(dummy.password);
        await db.insert(users).values({
          id: userId,
          email: dummy.email,
          password: hashed,
          firstName: dummy.firstName,
          lastName: dummy.lastName,
          role: dummy.role,
          isActive: true,
          isApproved: true,
        });
        console.log(`✓ Created ${dummy.role} user: ${dummy.email}`);

        // Create invitation record for this user
        if (adminUserId) {
          await createInvitationForUser(
            {
              id: userId,
              email: dummy.email,
              firstName: dummy.firstName,
              lastName: dummy.lastName,
              role: dummy.role,
            },
            adminUserId,
            25 // 25 days ago
          );
          console.log(`  ✓ Created invitation record for ${dummy.email}`);
        }
      } else {
        console.log(`User already exists: ${dummy.email}`);
        // User exists, check if invitation exists
        const user = exists[0];
        if (adminUserId) {
          await createInvitationForUser(
            {
              id: user.id,
              email: user.email || "",
              firstName: user.firstName || "",
              lastName: user.lastName || "",
              role: user.role,
            },
            adminUserId,
            25
          );
        }
      }
    }

    // Create invitation for admin user if it doesn't exist
    if (adminUserId) {
      const [adminUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, DEFAULT_ADMIN.email))
        .limit(1);

      if (adminUser) {
        await createInvitationForUser(
          {
            id: adminUser.id,
            email: adminUser.email || "",
            firstName: adminUser.firstName || DEFAULT_ADMIN.firstName,
            lastName: adminUser.lastName || DEFAULT_ADMIN.lastName,
            role: adminUser.role,
          },
          adminUserId, // Admin invited themselves (or use system)
          60 // 60 days ago (first user)
        );
      }
    }

    console.log("✓ User invitation records created/verified for all users");
  } catch (error) {
    console.error("Error seeding default users:", error);
    throw error;
  }
}
