import request from "supertest";
import { createTestApp } from "../helpers/testApp";
import { resetDb } from "../helpers/testDb";
import { createUser } from "../helpers/fixtures";
import { issueApiKey } from "../../../services/auth/apiKeys";
import { storage } from "../../../storage";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let ip = 120;
let key: string;

async function call(name: string, args: object) {
  const res = await request(ctx.app)
    .post("/api/mcp")
    .set("X-Forwarded-For", `198.51.100.${++ip}`)
    .set("Accept", "application/json, text/event-stream")
    .set("Authorization", `Bearer ${key}`)
    .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  expect(res.status).toBe(200);
  return {
    isError: !!res.body.result.isError,
    data: JSON.parse(res.body.result.content[0].text),
  };
}

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb();
  const admin = await createUser({ role: "admin" });
  key = (await issueApiKey({ userId: admin.id, name: "k" })).plaintext;
  for (let i = 0; i < 60; i++) {
    await storage.createTask({
      title: `T${i}`,
      category: "support",
      priority: i % 2 === 0 ? "high" : "low",
      createdBy: admin.id,
    } as never);
  }
});

describe("list_tickets paging", () => {
  it("limit 25 of 60 visible: hasMore, true total, and offsets reach every row exactly once", async () => {
    const first = await call("list_tickets", { limit: 25 });
    expect(first.isError).toBe(false);
    expect(first.data).toMatchObject({ limit: 25, offset: 0, returned: 25, hasMore: true, total: 60 });

    const seen: number[] = [];
    let offset = 0;
    for (;;) {
      const page = await call("list_tickets", { limit: 25, offset });
      seen.push(...page.data.tickets.map((t: { id: number }) => t.id));
      expect(page.data.total).toBe(60);
      if (!page.data.hasMore) break;
      offset += page.data.returned;
    }
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
  });

  it("the last page has hasMore false", async () => {
    const last = await call("list_tickets", { limit: 25, offset: 50 });
    expect(last.data).toMatchObject({ returned: 10, hasMore: false, total: 60 });
  });

  it("an exact fit is not hasMore", async () => {
    const all = await call("list_tickets", { limit: 60 });
    expect(all.data).toMatchObject({ returned: 60, hasMore: false, total: 60 });
  });

  it("a priority filter counts only matching rows", async () => {
    const res = await call("list_tickets", { priority: "high", limit: 10 });
    expect(res.data).toMatchObject({ returned: 10, hasMore: true, total: 30 });
  });

  it("a non-positive ticket id is VALIDATION from the service", async () => {
    const res = await call("get_ticket", { id: -3 });
    expect(res.isError).toBe(true);
    expect(res.data.code).toBe("VALIDATION");
  });

  it("an invalid status or priority is a VALIDATION error, never zero rows", async () => {
    for (const args of [{ status: "Waiting for Review" }, { priority: "critical" }, { limit: 0 }, { offset: -1 }]) {
      const res = await call("list_tickets", args);
      expect(res.isError).toBe(true);
      expect(res.data.code).toBe("VALIDATION");
    }
  });

  it("limit and offset accept a number or a numeric string (R47)", async () => {
    const str = await call("list_tickets", { limit: "10", offset: "5" });
    expect(str.isError).toBe(false);
    const num = await call("list_tickets", { limit: 10, offset: 5 });
    expect(str.data).toEqual(num.data);
    expect(str.data).toMatchObject({ limit: 10, offset: 5, returned: 10 });
  });

  it("a bad limit or offset is VALIDATION with fieldErrors on that field (R47)", async () => {
    const cases: Array<[object, string]> = [
      [{ limit: "abc" }, "limit"],
      [{ limit: "0" }, "limit"],
      [{ limit: 101 }, "limit"],
      [{ limit: "101" }, "limit"],
      [{ limit: "1.5" }, "limit"],
      [{ offset: "x" }, "offset"],
      [{ offset: "-1" }, "offset"],
      [{ offset: " 3" }, "offset"],
      [{ offset: 1.5 }, "offset"],
    ];
    for (const [args, field] of cases) {
      const res = await call("list_tickets", args);
      expect([args, res.isError, res.data.code]).toEqual([args, true, "VALIDATION"]);
      expect(res.data.details.fieldErrors[field]).toBeDefined();
    }
  });
});
