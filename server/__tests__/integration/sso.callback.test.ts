import request from "supertest";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { db } from "../../storage/db";
import { AI_SYSTEM_USER_EMAIL } from "../../utils/aiSystemUserId";

// MSAL is faked: the authorize URL echoes the state, and the code exchange
// answers with an id token whose payload the test chooses (`mockProfile`).
let mockProfile: Record<string, unknown> = {};
jest.mock("@azure/msal-node", () => ({
  ConfidentialClientApplication: class {
    async getAuthCodeUrl(req: { state: string }) {
      return `https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?state=${req.state}`;
    }
    async acquireTokenByCode() {
      const payload = Buffer.from(JSON.stringify(mockProfile)).toString("base64");
      return {
        idToken: `header.${payload}.signature`,
        accessToken: "fake-access-token",
        expiresOn: new Date(Date.now() + 3600 * 1000),
      };
    }
  },
}));

/**
 * C05 (A9) and R42: the first test that runs the Microsoft callback. A new SSO
 * account takes SSO_DEFAULT_ROLE (customer unless "agent") and waits for approval;
 * an existing account's role and approval are never touched by a later sign-in.
 */
describe("Microsoft SSO callback", () => {
  const saved = { ...process.env };
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    await resetDb();
    process.env.MICROSOFT_CLIENT_ID = "00000000-0000-0000-0000-000000000001";
    process.env.MICROSOFT_CLIENT_SECRET = "generated-test-secret";
    process.env.MICROSOFT_TENANT_ID = "00000000-0000-0000-0000-000000000002";
    delete process.env.SSO_DEFAULT_ROLE;
    ctx = await createTestApp();
  });
  afterAll(async () => {
    process.env = saved;
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb();
    delete process.env.SSO_DEFAULT_ROLE;
    (console.error as unknown as jest.Mock).mockClear?.();
  });

  /** Runs the whole flow: start (state in the session), then the callback. Returns the callback response. */
  async function signIn(profile: { sub: string; email: string; given_name?: string; family_name?: string }) {
    mockProfile = profile;
    const agent = request.agent(ctx.app);
    const start = await agent.get("/api/auth/microsoft").redirects(0);
    expect(start.status).toBe(302);
    const state = new URL(start.headers.location).searchParams.get("state")!;
    return agent.get("/api/auth/microsoft/callback").query({ code: "fake-code", state }).redirects(0);
  }
  const rowFor = async (sub: string) => (await db.select().from(users).where(eq(users.id, `ms_${sub}`)))[0];
  const roleLogLines = () =>
    ((console.error as unknown as jest.Mock).mock?.calls ?? [])
      .map((c: unknown[]) => c.map(String).join(" "))
      .filter((l: string) => l.includes("SSO_DEFAULT_ROLE"));

  it("unset: a new account is a customer, unapproved, sent to the pending answer", async () => {
    const res = await signIn({ sub: "new-1", email: "new1@example.test", given_name: "New", family_name: "One" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/auth?error=pending_approval");
    const row = await rowFor("new-1");
    expect(row.role).toBe("customer");
    expect(row.isApproved).toBe(false);
    expect(row.email).toBe("new1@example.test");
    expect(row.firstName).toBe("New");
    expect(roleLogLines()).toEqual([]);
  });

  it("SSO_DEFAULT_ROLE=agent: a new account is an agent, still unapproved", async () => {
    process.env.SSO_DEFAULT_ROLE = "agent";
    const res = await signIn({ sub: "new-2", email: "new2@example.test" });
    expect(res.headers.location).toBe("/auth?error=pending_approval");
    const row = await rowFor("new-2");
    expect(row.role).toBe("agent");
    expect(row.isApproved).toBe(false);
    expect(roleLogLines()).toEqual([]);
  });

  it("SSO_DEFAULT_ROLE=admin: one log line, and the account is a customer", async () => {
    process.env.SSO_DEFAULT_ROLE = "admin";
    await signIn({ sub: "new-3", email: "new3@example.test" });
    await signIn({ sub: "new-3b", email: "new3b@example.test" });
    expect((await rowFor("new-3")).role).toBe("customer");
    expect((await rowFor("new-3b")).role).toBe("customer");
    expect((await rowFor("new-3")).isApproved).toBe(false);
    expect(roleLogLines()).toHaveLength(1);
  });

  it("SSO_DEFAULT_ROLE=junk: one log line, and the account is a customer", async () => {
    process.env.SSO_DEFAULT_ROLE = "junk";
    await signIn({ sub: "new-4", email: "new4@example.test" });
    expect((await rowFor("new-4")).role).toBe("customer");
    expect(roleLogLines()).toHaveLength(1);
  });

  it("an existing agent signing in again keeps their role and approval", async () => {
    await db.insert(users).values({
      id: "ms_existing-1",
      email: "agent@example.test",
      firstName: "Old",
      role: "agent",
      isApproved: true,
      isActive: true,
    });
    // SSO_DEFAULT_ROLE unset (customer): a later sign-in must not demote or unapprove.
    const res = await signIn({ sub: "existing-1", email: "agent@example.test", given_name: "Renamed" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
    const row = await rowFor("existing-1");
    expect(row.role).toBe("agent");
    expect(row.isApproved).toBe(true);
    expect(row.firstName).toBe("Renamed"); // the profile still refreshes
  });

  it("an existing customer is not promoted by SSO_DEFAULT_ROLE=agent", async () => {
    process.env.SSO_DEFAULT_ROLE = "agent";
    await db.insert(users).values({
      id: "ms_existing-2",
      email: "cust@example.test",
      role: "customer",
      isApproved: false,
      isActive: true,
    });
    const res = await signIn({ sub: "existing-2", email: "cust@example.test" });
    expect(res.headers.location).toBe("/auth?error=pending_approval");
    const row = await rowFor("existing-2");
    expect(row.role).toBe("customer");
    expect(row.isApproved).toBe(false);
  });

  it("the AI system email is still refused, and no account is created", async () => {
    const res = await signIn({ sub: "ai-1", email: AI_SYSTEM_USER_EMAIL });
    expect(res.headers.location).toBe("/auth?error=account_inactive");
    expect(await rowFor("ai-1")).toBeUndefined();
  });
});
