import { ACT_AS_HEADER, activeActorId, endRun, openRun, resolveActAsUser } from "../../mcp/actAs";

/**
 * Acting for a signed-in person over MCP.
 *
 * The copilot has to create tickets as the CUSTOMER, but MCP only accepts an API key and a
 * browser must never hold one. So the agent sends X-TicketFlow-Act-As, and this is the whole
 * trust boundary. These checks pin it shut: an outside client adding the header is ignored, and
 * the copilot can never speak for an admin or a manager.
 *
 * The identity is resolved from storage, so the user rows are stubbed here.
 */
const rows: Record<string, { id: string; role: string }> = {
  "customer-1": { id: "customer-1", role: "customer" },
  "agent-1": { id: "agent-1", role: "agent" },
  "admin-1": { id: "admin-1", role: "admin" },
  "manager-1": { id: "manager-1", role: "manager" },
};

jest.mock("../../storage", () => ({
  storage: {
    getUser: async (id: string) => rows[id] ?? undefined,
  },
}));

describe("MCP act-as identity", () => {
  afterEach(() => endRun());

  it("is ignored when no copilot run is open", async () => {
    // Exactly what an outside client with a valid key sees, even naming a real user.
    expect(await resolveActAsUser("customer-1")).toBeNull();
    expect(activeActorId()).toBeNull();
  });

  it("acts for the signed-in customer during their run", async () => {
    const run = openRun({ id: "customer-1" });
    expect(activeActorId()).toBe("customer-1");
    expect(await resolveActAsUser("customer-1")).toMatchObject({ id: "customer-1", role: "customer" });
    run.close();
    expect(activeActorId()).toBeNull();
  });

  it("refuses a person who is not the one the run is for", async () => {
    openRun({ id: "customer-1" });
    expect(await resolveActAsUser("agent-1")).toBeNull();
  });

  it("never lets a copilot session act as an admin or a manager", async () => {
    for (const id of ["admin-1", "manager-1"]) {
      const run = openRun({ id });
      expect(await resolveActAsUser(id)).toBeNull();
      run.close();
    }
  });

  it("refuses an unknown id", async () => {
    openRun({ id: "ghost" });
    expect(await resolveActAsUser("ghost")).toBeNull();
  });

  it("is dormant without a header", async () => {
    openRun({ id: "customer-1" });
    expect(await resolveActAsUser(undefined)).toBeNull();
    expect(await resolveActAsUser("  ")).toBeNull();
  });

  it("uses a header name the router and the client share", () => {
    expect(ACT_AS_HEADER).toBe("x-ticketflow-act-as");
  });

  it("stays open for the whole run, and a late close cannot wipe a newer run", () => {
    const first = openRun({ id: "alice" });
    expect(activeActorId()).toBe("alice");
    first.close();
    const second = openRun({ id: "bob" });
    // A stale closer from the first run must not clear Bob's identity.
    first.close();
    expect(activeActorId()).toBe("bob");
    second.close();
    expect(activeActorId()).toBeNull();
  });
});
