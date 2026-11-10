import { type User } from "@shared/schema";
import { storage } from "../../../storage";
import { createTestApp } from "../helpers/testApp";
import { resetDb } from "../helpers/testDb";
import { createUser } from "../helpers/fixtures";
import { mcpFor, type McpCaller } from "../helpers/mcpClient";

/**
 * A ticket can be named by the number the UI shows (TKT-2026-0610) as well as by
 * its database id, because an agent reads the number off the page and a person
 * reads it aloud. These tests pin that contract and make sure the looser input
 * did not weaken the numeric-id rules: a value that is not a ticket number and
 * not a positive integer is still a coded VALIDATION.
 */

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let admin: User;
let owner: User;
let stranger: User;
let adminMcp: McpCaller;
let ownerMcp: McpCaller;
let strangerMcp: McpCaller;
let ticketId: number;
let ticketNumber: string;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb();
  admin = await createUser({ role: "admin" });
  owner = await createUser({ role: "customer" });
  stranger = await createUser({ role: "customer" });
  const t = await storage.createTask({
    title: "Printer will not connect",
    category: "support",
    createdBy: owner.id,
  } as never);
  ticketId = t.id;
  ticketNumber = t.ticketNumber;
  adminMcp = await mcpFor(ctx.app, admin);
  ownerMcp = await mcpFor(ctx.app, owner);
  strangerMcp = await mcpFor(ctx.app, stranger);
});

describe("get_ticket by ticket number", () => {
  it("the number gives the same ticket as the id", async () => {
    const byId = await adminMcp.call("get_ticket", { id: ticketId });
    const byNumber = await adminMcp.call("get_ticket", { id: ticketNumber });
    expect(byNumber.isError).toBe(false);
    expect(byNumber.data.id).toBe(ticketId);
    expect(byNumber.data).toEqual(byId.data);
  });

  it("accepts the string \"true\" for includeComments, the way a model sends it", async () => {
    await adminMcp.call("add_comment", { id: ticketNumber, content: "checked the cable" });
    const res = await adminMcp.call("get_ticket", { id: ticketNumber, includeComments: "true" as never });
    expect(res.isError).toBe(false);
    expect(res.data.comments.map((c: { content: string }) => c.content)).toContain("checked the cable");
  });

  it("an unknown ticket number is NOT_FOUND, not a validation error", async () => {
    const res = await adminMcp.call("get_ticket", { id: "TKT-1999-0001" });
    expect(res.isError).toBe(true);
    expect(res.data.code).toBe("NOT_FOUND");
  });

  it("access control is unchanged: a stranger cannot read it by number", async () => {
    const res = await strangerMcp.call("get_ticket", { id: ticketNumber });
    expect(res.isError).toBe(true);
    expect(res.data.code).toBe("FORBIDDEN");
  });
});

describe("the other ticket tools resolve a number too", () => {
  it("add_comment and get_ticket_history accept the number", async () => {
    const comment = await ownerMcp.call("add_comment", { id: ticketNumber, content: "still broken" });
    expect(comment.isError).toBe(false);
    expect(comment.data.taskId).toBe(ticketId);

    const history = await adminMcp.call("get_ticket_history", { id: ticketNumber });
    expect(history.isError).toBe(false);
    expect(history.data.ticketId).toBe(ticketId);
  });

  it("update_ticket accepts the number", async () => {
    const res = await adminMcp.call("update_ticket", { id: ticketNumber, notes: "triaged" });
    expect(res.isError).toBe(false);
    expect(res.data.ticket.id).toBe(ticketId);
  });
});

describe("a value that is neither an id nor a ticket number is still VALIDATION", () => {
  it.each(["abc", "TKT", "-12", "TKT-", "TKT 2026"])(
    "%s",
    async (bad) => {
      const res = await adminMcp.call("get_ticket", { id: bad as never });
      expect(res.isError).toBe(true);
      expect(res.data.code).toBe("VALIDATION");
      expect(res.data.details.fieldErrors.id).toBeDefined();
    }
  );
});