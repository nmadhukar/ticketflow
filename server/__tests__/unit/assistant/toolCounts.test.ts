import fs from "fs";
import path from "path";
import {
  ASSISTANT_PROPOSAL_TOOLS,
  ASSISTANT_READ_TOOLS,
  UNGRANTED_TICKET_TOOLS,
} from "../../../assistant/toolPolicy";

/**
 * The tool counts Mastra Studio shows for the two assistants: 19 for staff, 13 for the customer.
 *
 * Studio lists what each agent can call (run tools + its propose tools). The counts drifted before -
 * a tool added to one agent and not the other, or a proposal left out of the agent that needed it -
 * and nobody noticed until the Studio table was read. These checks pin both numbers and, more
 * usefully, prove nothing is missing: every ticket tool the MCP server registers is either granted
 * to an assistant or listed, with a reason, in UNGRANTED_TICKET_TOOLS.
 */
const read = (rel: string) =>
  fs.readFileSync([path.resolve(__dirname, "../../..", rel), path.resolve(__dirname, "../../../..", rel)].find(fs.existsSync)!, "utf8");

/** Tool names the MCP ticket tools file registers. */
function registeredTicketTools(): string[] {
  const source = read("server/mcp/tools.ts");
  return Array.from(source.matchAll(/registerTool\(\s*"([a-z_]+)"/g)).map((m) => m[1]);
}

const agentTools = (agentId: keyof typeof ASSISTANT_READ_TOOLS) =>
  ASSISTANT_READ_TOOLS[agentId].length + ASSISTANT_PROPOSAL_TOOLS[agentId].length;

describe("Mastra Studio tool counts", () => {
  it("shows 13 tools for the support assistant", () => {
    expect(agentTools("support-assistant")).toBe(13);
    expect(ASSISTANT_READ_TOOLS["support-assistant"]).toHaveLength(10);
    expect(ASSISTANT_PROPOSAL_TOOLS["support-assistant"]).toEqual([
      "propose_ticket",
      "propose_comment",
      "propose_close_ticket",
    ]);
    // 10 + 3 = 13 run tools; the 3 proposals are counted once each: 16 would be a regression.
    expect(new Set([...ASSISTANT_READ_TOOLS["support-assistant"], ...ASSISTANT_PROPOSAL_TOOLS["support-assistant"]]).size).toBe(13);
  });

  it("shows 19 tools for the ticket assistant", () => {
    expect(agentTools("ticket-assistant")).toBe(19);
    expect(ASSISTANT_READ_TOOLS["ticket-assistant"]).toHaveLength(18);
    expect(ASSISTANT_PROPOSAL_TOOLS["ticket-assistant"]).toEqual(["propose_comment"]);
    expect(new Set([...ASSISTANT_READ_TOOLS["ticket-assistant"], ...ASSISTANT_PROPOSAL_TOOLS["ticket-assistant"]]).size).toBe(19);
  });

  it("grants every registered ticket tool, or records why it is not granted", () => {
    const registered = registeredTicketTools();
    // A sanity floor: the file really was read (a wrong path would otherwise pass emptily).
    expect(registered.length).toBeGreaterThanOrEqual(8);

    const support = new Set(ASSISTANT_READ_TOOLS["support-assistant"]);
    const staff = new Set(ASSISTANT_READ_TOOLS["ticket-assistant"]);
    const ungranted = new Set(Object.keys(UNGRANTED_TICKET_TOOLS));
    for (const tool of registered) {
      // mark_notifications_read is registered by appTools, not tools.ts; skip if not present.
      const covered = support.has(tool) || staff.has(tool) || ungranted.has(tool);
      expect({ tool, covered }).toEqual({ tool, covered: true });
    }
  });

  it("never grants a write the proposal flow owns", () => {
    const granted = new Set([...ASSISTANT_READ_TOOLS["support-assistant"], ...ASSISTANT_READ_TOOLS["ticket-assistant"]]);
    for (const write of ["update_ticket", "close_ticket", "reopen_ticket", "delete_ticket", "create_ticket", "add_comment"]) {
      expect(granted.has(write)).toBe(false);
    }
  });
});
