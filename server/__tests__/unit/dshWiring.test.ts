import fs from "fs";
import path from "path";

/**
 * Phase 3: the DeepSeek Harness wiring kit. The harness is a separate product
 * with its own image and network, so the connection is configuration an operator
 * applies rather than code this repository runs. These checks keep that
 * configuration coherent: the profile patch names the client package and the
 * streamable HTTP transport for the real endpoint, the attach script joins the
 * harness to the TicketFlow network without disturbing either container, and the
 * handoff document points at the kit instead of describing the endpoint as
 * unconnected.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("DSH wiring kit", () => {
  const patch = read("docs/integrations/dsh/cordis.patch.yml");
  const attach = read("scripts/ai/dsh/attach-dsh-network.sh");
  const kit = read("docs/integrations/dsh/README.md");
  const handoff = read("docs/integrations/dsh-ticketflow-mcp.md");

  it("the profile patch registers the harness MCP client for the TicketFlow endpoint", () => {
    expect(patch).toContain("@deepseek-ai/dsh-mcp-client");
    expect(patch).toContain("streamable-http");
    expect(patch).toMatch(/serverName:\s*ticketflow/);
    expect(patch).toContain("/api/mcp");
    expect(patch).toContain("TICKETFLOW_MCP_KEY");
  });

  it("the patch reads the bearer from the harness environment and stores no key value", () => {
    expect(patch).toMatch(/process\.env\.TICKETFLOW_MCP_KEY/);
    expect(patch).not.toMatch(/tfk_[A-Za-z0-9_-]{20,}/);
  });

  it("the attach script joins a harness container to the TicketFlow network, idempotently", () => {
    expect(attach).toContain("docker network connect");
    expect(attach).toContain("ticketflow-network");
    expect(attach).toContain("dsh-local");
    expect(attach).toMatch(/Already attached/);
    // It must not move, stop or recreate either container.
    expect(attach).not.toMatch(/docker (rm|stop|kill|run)\b/);
  });

  it(".gitattributes keeps the attach script on LF, which bash needs", () => {
    expect(read(".gitattributes")).toMatch(/scripts\/ai\/dsh\/\*\s+text\s+eol=lf/);
  });

  it("the handoff document points at the kit and no longer claims the endpoint is unconnected", () => {
    expect(handoff).not.toMatch(/No DSH connection is configured or enabled/i);
    expect(handoff).toContain("docs/integrations/dsh/README.md");
  });

  it("the kit documents the scoped key, the transport and the verification handshake", () => {
    expect(kit).toContain("mcp:tickets");
    expect(kit).toContain("TICKETFLOW_MCP_KEY");
    expect(kit).toContain("tools/list");
    expect(kit).toContain("/api/mcp");
  });
});
