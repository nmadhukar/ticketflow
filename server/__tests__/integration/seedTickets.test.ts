import { like } from "drizzle-orm";
import { departments, tasks } from "@shared/schema";
import { db } from "../../storage/db";
import { seedTickets } from "../../seed/seedTickets";
import { seedKnowledgeLearning } from "../../seed/seed-knowledge-learning";
import { createUser } from "./helpers/fixtures";
import { resetDb } from "./helpers/testDb";

// The seeders run on every start while SEED_DEMO_DATA=true: the demo tickets must be written once.
describe("demo ticket seeders", () => {
  beforeEach(async () => {
    await resetDb();
    await createUser({ role: "customer", email: "customer1@ticketflow.local" });
    await db.insert(departments).values({ name: "Seed test department" });
  });

  it("writes the knowledge learning tickets once, however often it runs", async () => {
    await createUser({ role: "admin", email: "admin@ticketflow.local" });
    const count = async () => (await db.select({ id: tasks.id }).from(tasks)).length;
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await seedKnowledgeLearning();
      const first = await count();
      expect(first).toBe(5);
      await seedKnowledgeLearning();
      expect(await count()).toBe(first);
    } finally {
      log.mockRestore();
    }
  });

  it("writes the demo department tickets once, however often it runs", async () => {
    const demo = () => db.select({ id: tasks.id }).from(tasks).where(like(tasks.description, "Ticket randomly assigned to department: %"));
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await seedTickets();
      const first = (await demo()).length;
      expect(first).toBeGreaterThanOrEqual(15);
      await seedTickets();
      await seedTickets();
      expect((await demo()).length).toBe(first);
    } finally {
      log.mockRestore();
    }
  });
});
