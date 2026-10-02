import { createTestApp } from "./helpers/testApp";
import { hasTicketCreatedBroadcaster } from "../../services/tickets/create";

/**
 * Merge guard. Inbound email broadcasts "ticket:created" through a setter that registerRoutes
 * must call once it owns the sockets. If a merge (e.g. a WebSocket rewrite) drops that call,
 * emailed tickets would silently stop notifying anyone.
 */
describe("registerRoutes wires the ticket-created broadcaster", () => {
  it("has a real broadcaster after the real app is built", async () => {
    expect(hasTicketCreatedBroadcaster()).toBe(false); // a fresh module registry starts with none
    const ctx = await createTestApp();
    try {
      expect(hasTicketCreatedBroadcaster()).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});
