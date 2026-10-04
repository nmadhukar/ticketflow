import { createTestApp } from "./helpers/testApp";
import { resetDb } from "./helpers/testDb";
import { createUser, loginAs } from "./helpers/fixtures";
import { storage } from "../../storage";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDb);

it("history explicitly includes read notifications for the caller while default and unread requests stay compatible", async () => {
  const user = await createUser({ role: "agent" });
  const other = await createUser({ role: "agent" });
  const unread = await storage.createNotification({ userId: user.id, title: "New assignment", content: "Unread", type: "task_assigned" });
  const read = await storage.createNotification({ userId: user.id, title: "Previous assignment", content: "Read", type: "task_assigned" });
  await storage.markNotificationsRead(user.id, [read.id]);
  await storage.createNotification({ userId: other.id, title: "Private assignment", content: "Another user", type: "task_assigned" });
  const client = await loginAs(ctx.app, user);
  for (const url of ["/api/notifications", "/api/notifications?read=false&limit=50"]) {
    const response = await client.get(url).expect(200);
    expect(response.body.map((item: { id: number }) => item.id)).toEqual([unread.id]);
  }
  const history = await client.get("/api/notifications?read=all&limit=50").expect(200);
  expect(history.body.map((item: { id: number }) => item.id).sort()).toEqual([read.id, unread.id].sort());
});

it("rejects invalid or unbounded history limits", async () => {
  const client = await loginAs(ctx.app, await createUser({ role: "agent" }));
  for (const limit of ["0", "-1", "101", "abc", "5extra"]) {
    await client.get(`/api/notifications?read=all&limit=${limit}`).expect(400);
  }
});
