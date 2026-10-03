import { closeDb, resetDb } from "./helpers/testDb";
import { createUser } from "./helpers/fixtures";
import { storage } from "../../storage";

// Replaces the task/comment/update cases of the old mocked storage.test.ts,
// which chained fake drizzle builders and broke on every query change.
describe("DatabaseStorage against Postgres", () => {
  afterAll(async () => { await closeDb(); });
  beforeEach(async () => { await resetDb(); });

  it("upserts an existing user in place", async () => {
    const user = await createUser({ role: "agent" });
    const updated = await storage.upsertUser({ id: user.id, email: user.email, firstName: "Updated", role: "agent" });
    expect(updated.id).toBe(user.id);
    expect(updated.firstName).toBe("Updated");
    expect((await storage.getAllUsers())).toHaveLength(1);
  });

  it("creates tasks with sequential ticket numbers and filters by status", async () => {
    const user = await createUser({ role: "agent" });
    const first = await storage.createTask({ title: "One", category: "support", createdBy: user.id });
    const second = await storage.createTask({ title: "Two", category: "bug", status: "resolved", createdBy: user.id });

    expect(first.ticketNumber).toMatch(/^TKT-/);
    expect(second.ticketNumber).not.toBe(first.ticketNumber);

    const admin = await createUser({ role: "admin" });
    const open = await storage.getVisibleTasksForUser({ userId: admin.id, role: "admin", status: "open" });
    expect(open.map((t) => t.id)).toEqual([first.id]);
  });

  it("stores task comments and returns them with their author", async () => {
    const user = await createUser({ role: "agent" });
    const task = await storage.createTask({ title: "Commented", category: "support", createdBy: user.id });
    await storage.addTaskComment({ taskId: task.id, userId: user.id, content: "first!" });

    const comments = await storage.getTaskComments(task.id);
    expect(comments).toHaveLength(1);
    expect(comments[0].content).toBe("first!");
    expect(comments[0].user?.id).toBe(user.id);
  });
});
