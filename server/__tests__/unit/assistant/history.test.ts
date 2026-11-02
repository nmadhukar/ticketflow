import { firstValueFrom, of, toArray } from "rxjs";
import type { User } from "@shared/schema";
import {
  clientThreadId,
  getHistory,
  HistoryError,
  listHistory,
  mastraThreadId,
  newestTurn,
  ticketNumbersIn,
  type HistoryDeps,
} from "../../../assistant/history";
import { historyAgentClass } from "../../../assistant/bridge";

const user = { id: "staff-1", role: "agent" } as User;

function fakeDeps(responses: Array<{ status: number; body?: unknown }>, visible: string[] = []) {
  const started: string[] = [];
  const ended: string[] = [];
  const calls: string[] = [];
  const visibilityCalls: string[][] = [];
  const deps: HistoryDeps = {
    agentUrl: "http://agents.test:4111",
    runs: async () =>
      ({
        start: (userId: string, agentId: string) => {
          started.push(`${userId}/${agentId}`);
          return { runId: `run-${started.length}`, agentToken: "agent-token", mcpToken: "mcp-token" };
        },
        end: (runId: string) => ended.push(runId),
      }) as never,
    fetch: (async (url: URL, init: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
      const next = responses.shift() ?? { status: 500 };
      return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status });
    }) as typeof fetch,
    visibleTickets: async (_u, numbers) => {
      visibilityCalls.push(numbers);
      return new Set(numbers.filter((n) => visible.includes(n)));
    },
  };
  return { deps, started, ended, calls, visibilityCalls };
}

describe("assistant history", () => {
  it("prefixes thread ids with the user, and recognises only that user's", () => {
    expect(mastraThreadId("u1", "abc")).toBe("u:u1:abc");
    expect(clientThreadId("u1", "u:u1:abc")).toBe("abc");
    expect(clientThreadId("u1", "u:u12:abc")).toBeNull();
    expect(clientThreadId("u1", "abc")).toBeNull();
  });

  it("sends only the newest turn", () => {
    const m = [{ role: "user", id: 1 }, { role: "assistant", id: 2 }, { role: "user", id: 3 }, { role: "assistant", id: 4 }];
    expect(newestTurn(m).map((x) => x.id)).toEqual([3, 4]);
    expect(newestTurn([{ role: "assistant", id: 9 }]).map((x) => x.id)).toEqual([9]);
  });

  it("finds every ticket number, tool results included", () => {
    expect(ticketNumbersIn([{ content: { parts: [{ text: "see tkt-2026-0001" }, { type: "tool-result", result: '{"ticketNumber":"TKT-2026-0151"}' }] } }])).toEqual([
      "TKT-2026-0001",
      "TKT-2026-0151",
    ]);
  });

  it("lists this user's threads only, newest first, and always ends the run it opened", async () => {
    const { deps, started, ended, calls } = fakeDeps([
      {
        status: 200,
        body: {
          threads: [
            { id: "u:staff-1:old", title: "", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" },
            { id: "u:someone-else:x", title: "", createdAt: "2026-11-02T00:00:00Z", updatedAt: "2026-11-02T00:00:00Z" },
            { id: "u:staff-1:new", title: "Queue", createdAt: "2026-11-02T00:00:00Z", updatedAt: "2026-11-02T09:00:00Z" },
          ],
        },
      },
    ]);
    const threads = await listHistory(deps, user);
    expect(threads.map((t) => t.threadId)).toEqual(["new", "old"]);
    expect(threads[0].title).toBe("Queue");
    expect(threads[1].title).toBeNull();
    expect(started).toEqual(["staff-1/ticket-assistant"]);
    expect(ended).toEqual(["run-1"]);
    expect(calls[0]).toMatch(/^GET \/api\/memory\/threads\?.*agentId=ticket-assistant/);
  });

  it("reads every page of a conversation and returns its text only", async () => {
    const msg = (role: string, text: string) => ({ role, createdAt: "2026-11-02T09:00:00Z", content: { parts: [{ type: "text", text }] } });
    const { deps, calls, ended } = fakeDeps(
      [
        { status: 200, body: { messages: [msg("user", "Status of TKT-2026-0151?"), { role: "assistant", createdAt: "x", content: { parts: [{ type: "tool-invocation" }] } }], hasMore: true } },
        { status: 200, body: { messages: [msg("assistant", "It is open.")], hasMore: false } },
      ],
      ["TKT-2026-0151"],
    );
    const result = await getHistory(deps, user, "t1");
    expect(result).toEqual({
      available: true,
      messages: [
        { role: "user", text: "Status of TKT-2026-0151?", createdAt: "2026-11-02T09:00:00Z" },
        { role: "assistant", text: "It is open.", createdAt: "2026-11-02T09:00:00Z" },
      ],
    });
    expect(calls.map((c) => c.match(/page=(\d+)/)?.[1])).toEqual(["0", "1"]);
    expect(calls[0]).toContain(encodeURIComponent("u:staff-1:t1"));
    // One run for the whole read, whatever the number of pages.
    expect(ended).toHaveLength(1);
  });

  it("withholds a conversation that mentions a ticket the user can no longer see", async () => {
    const { deps } = fakeDeps([{ status: 200, body: { messages: [{ role: "user", createdAt: "x", content: { parts: [{ type: "text", text: "TKT-2026-0099 please" }] } }] } }], []);
    await expect(getHistory(deps, user, "t1")).resolves.toEqual({ available: false, reason: "access_changed" });
  });

  it("404 is not found; any other refusal is unavailable, never an empty list", async () => {
    const missing = fakeDeps([{ status: 404 }]);
    await expect(getHistory(missing.deps, user, "t1")).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(missing.ended).toHaveLength(1);
    for (const status of [403, 500]) {
      const { deps, ended } = fakeDeps([{ status }]);
      await expect(listHistory(deps, user)).rejects.toMatchObject({ status: 503, code: "history_unavailable" });
      expect(ended).toHaveLength(1);
    }
    const down = fakeDeps([]);
    down.deps.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(listHistory(down.deps, user)).rejects.toBeInstanceOf(HistoryError);
  });

  it("checks every mentioned ticket in one call", async () => {
    const many = Array.from({ length: 40 }, (_, i) => `TKT-2026-${String(i).padStart(4, "0")}`);
    const { deps, visibilityCalls } = fakeDeps([{ status: 200, body: { messages: [{ role: "assistant", createdAt: "x", content: { parts: [{ type: "text", text: many.join(" ") }] } }] } }], many);
    await expect(getHistory(deps, user, "t1")).resolves.toMatchObject({ available: true });
    expect(visibilityCalls).toHaveLength(1);
    expect(visibilityCalls[0]).toHaveLength(40);
  });
});

describe("staff agent with saved conversations", () => {
  class FakeAgent {
    static seen: Array<{ threadId: string; messages: unknown[] }> = [];
    run(input: { threadId: string; messages: Array<{ role?: string }> }) {
      FakeAgent.seen.push(input);
      return of({ type: "RUN_STARTED", threadId: input.threadId }, { type: "TEXT", delta: "hi" });
    }
    clone() {
      return new FakeAgent();
    }
  }

  it("prefixes the thread for Mastra, restores it in events, and sends only the newest turn", async () => {
    const Agent = historyAgentClass(FakeAgent, "staff-1");
    const agent = new Agent();
    const events = await firstValueFrom(
      agent.run({ threadId: "t1", messages: [{ role: "user" }, { role: "assistant" }, { role: "user" }] }).pipe(toArray()),
    );
    expect(FakeAgent.seen.at(-1)).toMatchObject({ threadId: "u:staff-1:t1", messages: [{ role: "user" }] });
    expect(events[0]).toEqual({ type: "RUN_STARTED", threadId: "t1" });
    // CopilotKit clones the agent per run; the clone must keep the behaviour.
    const copy = agent.clone() as InstanceType<typeof Agent>;
    copy.run({ threadId: "t2", messages: [{ role: "user" }] });
    expect(FakeAgent.seen.at(-1)?.threadId).toBe("u:staff-1:t2");
  });
});
