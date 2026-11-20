import { CUSTOMER_TOOL_ALLOWLIST, DEFAULT_TRIAGE_TOOL_ALLOWLIST } from "../../mastra/config";
/**
 * A customer's copilot can PROPOSE a write, never perform one.
 *
 * The defect this guards: CUSTOMER_TOOL_ALLOWLIST contained create_ticket and add_comment, so the
 * model was handed a direct write. "Please raise a ticket" came back as "I've raised a ticket, your
 * number is TKT-..." - already created, no card, no confirmation. The propose tools (propose_ticket,
 * propose_comment, propose_close_ticket) record a draft the customer confirms on a card; those are
 * the only write path.
 *
 * The prompt half lives in ticketAgent.test.ts (that file cannot import this module: it pulls in the
 * Mastra agent). Together they pin both halves, and e2e/copilot-guardrails.spec.ts proves the UI.
 */
const DIRECT_WRITES = ["create_ticket", "add_comment", "update_ticket", "close_ticket", "reopen_ticket", "delete_ticket"];

describe("customer copilot tool list", () => {
  it("grants no direct write tool", () => {
    for (const write of DIRECT_WRITES) {
      expect({ write, granted: CUSTOMER_TOOL_ALLOWLIST.includes(write) }).toEqual({ write, granted: false });
    }
  });

  it("still grants the reads a customer needs", () => {
    for (const read of ["get_ticket", "list_tickets", "get_ticket_history", "search_knowledge", "get_knowledge_article"]) {
      expect({ read, granted: CUSTOMER_TOOL_ALLOWLIST.includes(read) }).toEqual({ read, granted: true });
    }
  });

  it("asks the model to propose a ticket rather than create one", () => {
    // The prompt rule is asserted in ticketAgent.test.ts; here the tool list itself must be reads only.
    expect(CUSTOMER_TOOL_ALLOWLIST.every((name) => !DIRECT_WRITES.includes(name))).toBe(true);
  });
});

describe("triage tool list", () => {
  it("drafts a comment rather than posting one", () => {
    expect(DEFAULT_TRIAGE_TOOL_ALLOWLIST.includes("add_comment")).toBe(false);
    expect(DEFAULT_TRIAGE_TOOL_ALLOWLIST).toContain("check_citation");
  });
});
