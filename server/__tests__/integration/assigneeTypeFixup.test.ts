import { eq } from "drizzle-orm";
import { tasks } from "@shared/schema";
import { resetDb } from "./helpers/testDb";
import { createTeam, createUser } from "./helpers/fixtures";
import { db } from "../../storage/db";
import { migrateAssigneeTypes } from "../../seed/assigneeTypeFixup";
import { runSeeders, type SeederSet } from "../../seed/runSeeders";

describe("assignee type fix-up", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function fixtureRows() {
    const admin = await createUser({ role: "admin" });
    const agent = await createUser({ role: "agent" });
    const team = await createTeam(admin);
    const old = new Date("2020-01-01T00:00:00Z");
    let n = 0;
    const mk = async (over: Record<string, unknown>) =>
      (
        await db
          .insert(tasks)
          .values({
            ticketNumber: `TKT-FX-${++n}`,
            title: "t",
            category: "support",
            createdBy: admin.id,
            updatedAt: old,
            ...over,
          } as any)
          .returning()
      )[0];
    return {
      agent,
      team,
      old,
      nullUser: await mk({ assigneeType: null, assigneeId: agent.id }),
      nullTeam: await mk({ assigneeType: null, assigneeTeamId: team.id }),
      nullBoth: await mk({ assigneeType: null, assigneeId: agent.id, assigneeTeamId: team.id }),
      staleTeam: await mk({ assigneeType: "team", assigneeId: agent.id, assigneeTeamId: team.id }),
      userNoUser: await mk({ assigneeType: "user", assigneeId: null, assigneeTeamId: team.id }),
      garbage: await mk({ assigneeType: "group", assigneeId: agent.id }),
      garbageNone: await mk({ assigneeType: "bogus" }),
      deptOnly: await mk({ assigneeType: null }),
      cleanUser: await mk({ assigneeType: "user", assigneeId: agent.id }),
      cleanTeam: await mk({ assigneeType: "team", assigneeTeamId: team.id }),
      cleanNone: await mk({ assigneeType: "user" }),
    };
  }

  const read = async (id: number) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0];

  it("makes every inconsistent row consistent, is idempotent, and leaves consistent rows untouched", async () => {
    const f = await fixtureRows();
    const changed = await migrateAssigneeTypes();
    expect(changed).toBeGreaterThan(0);

    const expectRow = async (id: number, type: string | null, assigneeId: string | null, teamId: number | null) => {
      const r = await read(id);
      expect([r.assigneeType, r.assigneeId, r.assigneeTeamId]).toEqual([type, assigneeId, teamId]);
    };
    await expectRow(f.nullUser.id, "user", f.agent.id, null);
    await expectRow(f.nullTeam.id, "team", null, f.team.id);
    await expectRow(f.nullBoth.id, "user", f.agent.id, null);
    await expectRow(f.staleTeam.id, "team", null, f.team.id);
    await expectRow(f.userNoUser.id, "team", null, f.team.id);
    await expectRow(f.garbage.id, "user", f.agent.id, null);
    await expectRow(f.garbageNone.id, "user", null, null);
    await expectRow(f.deptOnly.id, null, null, null); // department-only: legitimately NULL

    // Second run changes nothing.
    const snapshot = await db.select().from(tasks).orderBy(tasks.id);
    expect(await migrateAssigneeTypes()).toBe(0);
    expect(await db.select().from(tasks).orderBy(tasks.id)).toEqual(snapshot);

    // Rows that were already consistent kept their updated_at (the fix-up never bumps it).
    for (const row of [f.cleanUser, f.cleanTeam, f.cleanNone, f.nullUser, f.staleTeam]) {
      expect((await read(row.id)).updatedAt?.toISOString()).toBe(f.old.toISOString());
    }
    await expectRow(f.cleanUser.id, "user", f.agent.id, null);
    await expectRow(f.cleanTeam.id, "team", null, f.team.id);
    await expectRow(f.cleanNone.id, "user", null, null);
  });

  it("runSeeders runs it right after the role fix-up", async () => {
    const order: string[] = [];
    const noop = async () => {};
    const seeders = {
      migrateLegacyRoles: async () => void order.push("roles"),
      migrateAssigneeTypes: async () => void order.push("assignees"),
      systemUser: async () => void order.push("systemUser"),
      emailTemplates: noop,
      deactivateDemoAccounts: noop,
      bootstrapAdmin: noop,
    } as unknown as SeederSet;
    await runSeeders({ NODE_ENV: "production" }, seeders);
    expect(order).toEqual(["roles", "assignees", "systemUser"]);
  });
});
