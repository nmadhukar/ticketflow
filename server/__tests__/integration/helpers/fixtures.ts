import { randomUUID } from "crypto";
import request from "supertest";
import type { Express } from "express";
import { storage } from "../../../storage";
import { db } from "../../../storage/db";
import { hashPassword } from "../../../services/auth";
import { departments, type Team, type User } from "@shared/schema";

/** `user` is the legacy role: the server treats it as an agent. */
export type TestRole = "admin" | "manager" | "agent" | "customer" | "user";

export const DEFAULT_PASSWORD = "Passw0rd!test";

export async function createUser(opts: {
  role: TestRole;
  email?: string;
  password?: string;
  isApproved?: boolean;
  isActive?: boolean;
}): Promise<User> {
  const id = randomUUID();
  return storage.createUser({
    id,
    email: opts.email ?? `${opts.role}-${id.slice(0, 8)}@example.test`,
    password: await hashPassword(opts.password ?? DEFAULT_PASSWORD),
    firstName: opts.role,
    lastName: "Tester",
    role: opts.role,
    isApproved: opts.isApproved ?? true,
    isActive: opts.isActive ?? true,
  });
}

/** Logs in through POST /api/auth/login; the returned agent keeps the session cookie. */
export async function loginAs(
  app: Express,
  user: User,
  password: string = DEFAULT_PASSWORD
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/auth/login")
    .send({ email: user.email, password });
  if (res.status !== 200) {
    throw new Error(
      `loginAs(${user.email}) failed: ${res.status} ${JSON.stringify(res.body)}`
    );
  }
  return agent;
}

/**
 * Creates a team directly in the database. Unless `departmentId` is given, a
 * fresh active department managed by `managerOrAdmin` is created for it.
 *
 * This writes through the database and `storage`, NOT the API, so it bypasses
 * every permission check. Use it to arrange state; never rely on it to prove
 * what the API allows. Permission tests must create teams through the routes.
 */
export async function createTeam(
  managerOrAdmin: User,
  opts: { name?: string; departmentId?: number } = {}
): Promise<Team> {
  let departmentId = opts.departmentId;
  if (departmentId === undefined) {
    const [department] = await db
      .insert(departments)
      .values({
        name: `Dept ${randomUUID().slice(0, 8)}`,
        managerId: managerOrAdmin.id,
      })
      .returning();
    departmentId = department.id;
  }
  return storage.createTeam({
    name: opts.name ?? `Team ${randomUUID().slice(0, 8)}`,
    departmentId,
    createdBy: managerOrAdmin.id,
  });
}

/** POSTs /api/tasks as the logged-in agent and returns the raw response. */
export async function createTicketAs(
  agent: ReturnType<typeof request.agent>,
  body: Record<string, unknown> = {}
) {
  return agent.post("/api/tasks").send({
    title: "Test ticket",
    description: "Created by the integration harness",
    category: "support",
    priority: "medium",
    ...body,
  });
}
