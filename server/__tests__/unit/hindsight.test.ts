import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// The client imports the database only for its resolved-ticket helper; nothing here
// touches a real one. The unit boundary is the fetch the client makes.
jest.mock("../../storage/db", () => ({ db: { select: jest.fn() }, pool: {} }));

import type { Task } from "@shared/schema";
import { recallMemories, retainMemory, retainResolvedTicketMemory, isHindsightEnabled } from "../../services/ai/hindsight";

const ENABLED = {
  HINDSIGHT_ENABLED: "true",
  HINDSIGHT_URL: "http://memory.test:8888/",
  HINDSIGHT_API_KEY: "memory-key",
  HINDSIGHT_BANK_ID: "ticketflow-test",
} as NodeJS.ProcessEnv;

const ok = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200, headers: { "Content-Type": "application/json" },
});

type FetchArgs = [input: string, init: { headers: Record<string, string>; body: string }];
type FetchFn = (input: string, init: FetchArgs[1]) => Promise<Response>;
const fetchMock = () => globalThis.fetch as unknown as jest.Mock<FetchFn>;
const callAt = (n: number) => fetchMock().mock.calls[n];

describe("Hindsight memory client", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    globalThis.fetch = jest.fn() as unknown as typeof globalThis.fetch;
  });

  it("is off unless HINDSIGHT_ENABLED is exactly true", () => {
    expect(isHindsightEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isHindsightEnabled({ HINDSIGHT_ENABLED: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isHindsightEnabled({ HINDSIGHT_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("makes no request while the feature is off", async () => {
    expect(await recallMemories("printer jam", 5, {} as NodeJS.ProcessEnv)).toEqual([]);
    expect(await retainMemory({ content: "x" }, {} as NodeJS.ProcessEnv)).toBe(false);
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it("recalls memories from the bank, sending the query and the bearer token", async () => {
    fetchMock().mockResolvedValue(ok({ results: [{ text: "Restart the print spooler." }, { content: "Reinstall the driver." }] }));

    const memories = await recallMemories("printer jam", 5, ENABLED);

    expect(memories).toEqual(["Restart the print spooler.", "Reinstall the driver."]);
    const [url, init] = callAt(0);
    // The trailing slash on HINDSIGHT_URL is trimmed, and the bank id reaches the path.
    expect(url).toBe("http://memory.test:8888/v1/default/banks/ticketflow-test/memories/recall");
    expect(init.headers.authorization).toBe("Bearer memory-key");
    expect(JSON.parse(init.body)).toMatchObject({ query: "printer jam" });
  });

  it("retains one memory as an item, with a generated document id when given", async () => {
    fetchMock().mockResolvedValue(ok({}));

    const stored = await retainMemory({
      content: "Ticket TKT-1: printer jam", context: "resolved support ticket",
      documentId: "ticket-9", tags: ["support", "resolved"],
    }, ENABLED);

    expect(stored).toBe(true);
    const [url, init] = callAt(0);
    expect(url).toBe("http://memory.test:8888/v1/default/banks/ticketflow-test/memories");
    expect(JSON.parse(init.body)).toEqual({
      items: [{ content: "Ticket TKT-1: printer jam", context: "resolved support ticket", document_id: "ticket-9", tags: ["support", "resolved"] }],
    });
  });

  it("omits the authorization header when no key is configured", async () => {
    fetchMock().mockResolvedValue(ok([]));
    await recallMemories("anything", 5, { HINDSIGHT_ENABLED: "true", HINDSIGHT_URL: "http://memory.test:8888" } as NodeJS.ProcessEnv);
    const [, init] = callAt(0);
    expect(init.headers.authorization).toBeUndefined();
  });

  it("never throws and answers empty when the service errors", async () => {
    fetchMock().mockRejectedValue(new Error("connection refused"));
    expect(await recallMemories("printer jam", 5, ENABLED)).toEqual([]);
    expect(await retainMemory({ content: "x" }, ENABLED)).toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });

  it("treats a non-2xx recall as no memories", async () => {
    fetchMock().mockResolvedValue(new Response("{}", { status: 503 }));
    expect(await recallMemories("printer jam", 5, ENABLED)).toEqual([]);
  });

  it("refuses an empty query or an empty memory without calling the service", async () => {
    expect(await recallMemories("   ", 5, ENABLED)).toEqual([]);
    expect(await retainMemory({ content: "  " }, ENABLED)).toBe(false);
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it("does not query the database for a resolved-ticket memory while the feature is off", async () => {
    expect(await retainResolvedTicketMemory({ id: 1, title: "t", ticketNumber: "TKT-1" } as Task, {} as NodeJS.ProcessEnv)).toBe(false);
    expect(fetchMock()).not.toHaveBeenCalled();
  });
});