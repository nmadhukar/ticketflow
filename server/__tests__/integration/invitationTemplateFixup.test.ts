import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { emailTemplates } from "@shared/schema";
import { db } from "../../storage/db";
import { resetDb } from "./helpers/testDb";
import { defaultEmailTemplates } from "../../services/ses/emailTemplates";
import { runSeeders, type SeederSet } from "../../seed/runSeeders";
import { OLD_USER_INVITATION_BODY, updateOldInvitationTemplate } from "../../seed/invitationTemplateFixup";

/**
 * R43 follow-up: a database that already holds the OLD default `user_invitation` template (the one
 * with the "Department:" line) gets the new default at startup, and only then. An edited template,
 * or one that is already the new default, is never touched, and running the fix-up again changes nothing.
 */
const NEW = defaultEmailTemplates.find((t) => t.name === "user_invitation")!;
const OLD_VARIABLES = ["companyName", "invitedName", "inviterName", "email", "role", "department", "registrationUrl", "year"];

async function stored() {
  const [row] = await db.select().from(emailTemplates).where(eq(emailTemplates.name, "user_invitation"));
  return row;
}

async function store(body: string, variables: string[] = OLD_VARIABLES) {
  await db.insert(emailTemplates).values({ name: "user_invitation", subject: NEW.subject, body, variables, isActive: true });
}

describe("updateOldInvitationTemplate", () => {
  beforeEach(async () => {
    await resetDb();
    jest.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("the OLD constant is the old default exactly: pinned by hash, with the Department line the new default lacks", () => {
    // Pinned from `git show 871f104^:server/services/ses/emailTemplates.ts` (the default before R43).
    expect(createHash("sha256").update(OLD_USER_INVITATION_BODY).digest("hex")).toBe(
      "f470047fd2403de36684776815e2b03f7004cf95d8b749c13b1a589a1cb2256f"
    );
    expect(OLD_USER_INVITATION_BODY).toContain("Department: {{department}}");
    expect(NEW.body).not.toMatch(/department/i);
    expect(NEW.variables).not.toContain("department");
  });

  it("a stored copy equal to the old default becomes the new default (body and variables), and a second run changes nothing", async () => {
    await store(OLD_USER_INVITATION_BODY);
    expect(await updateOldInvitationTemplate()).toBe(1);
    const row = await stored();
    expect(row.body).toBe(NEW.body);
    expect(row.body).not.toMatch(/department/i);
    expect(row.variables).toEqual(NEW.variables);
    expect(row.subject).toBe(NEW.subject);

    expect(await updateOldInvitationTemplate()).toBe(0);
    expect(await stored()).toEqual(row);
  });

  it("a template an admin edited, even by one character, is left alone", async () => {
    for (const edited of [OLD_USER_INVITATION_BODY + " ", OLD_USER_INVITATION_BODY.replace("Welcome", "Hello"), OLD_USER_INVITATION_BODY.replace("Department: {{department}}", "Dept: {{department}}")]) {
      await resetDb();
      await store(edited);
      expect(await updateOldInvitationTemplate()).toBe(0);
      expect((await stored()).body).toBe(edited);
      expect((await stored()).variables).toEqual(OLD_VARIABLES);
    }
  });

  it("an already-new template, and an absent one, are left alone", async () => {
    await store(NEW.body, [...NEW.variables]);
    const before = await stored();
    expect(await updateOldInvitationTemplate()).toBe(0);
    expect(await stored()).toEqual(before);

    await resetDb();
    expect(await updateOldInvitationTemplate()).toBe(0);
    expect(await stored()).toBeUndefined();
  });
});

describe("startup order", () => {
  it("runSeeders runs the invitation template fix-up right after the default templates are seeded", async () => {
    const order: string[] = [];
    const step = (name: string) => async () => {
      order.push(name);
    };
    const seeders = {
      systemUser: step("systemUser"),
      aiSystemUser: step("aiSystemUser"),
      deactivateDemoAccounts: step("demo"),
      bootstrapAdmin: step("admin"),
      emailTemplates: step("templates"),
      updateOldInvitationTemplate: step("invitationTemplate"),
    } as unknown as SeederSet;
    await runSeeders({} as NodeJS.ProcessEnv, seeders);
    expect(order).toEqual(["demo", "systemUser", "aiSystemUser", "templates", "invitationTemplate", "admin"]);
  });

  it("a failure of the fix-up is logged and startup goes on (templates are data, not security)", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const order: string[] = [];
    const seeders = {
      systemUser: async () => void order.push("systemUser"),
      aiSystemUser: async () => void order.push("aiSystemUser"),
      deactivateDemoAccounts: async () => void order.push("demo"),
      bootstrapAdmin: async () => void order.push("admin"),
      emailTemplates: async () => void order.push("templates"),
      updateOldInvitationTemplate: async () => {
        throw new TypeError("secret text must not be logged");
      },
    } as unknown as SeederSet;
    await expect(runSeeders({} as NodeJS.ProcessEnv, seeders)).resolves.toBeUndefined();
    expect(order).toContain("admin");
    const logged = error.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("invitation template");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("secret text");
    error.mockRestore();
  });
});
