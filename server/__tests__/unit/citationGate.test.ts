import { checkCitation } from "../../mcp/citationTools";

const vpn = {
  id: 2,
  title: "Quick Fixes: VPN Not Connecting",
  summary: "Steps to restore a VPN connection: check internet, date and time, update the client.",
  content:
    "Check the internet connection. Confirm the Windows date and time are automatic. Update the VPN client. Reboot. Allow UDP 1194 or IKEv2 on the firewall.",
};

describe("RAG citation gate", () => {
  it("grounds a draft that uses the article's own steps", () => {
    const draft =
      "Check your internet, confirm the date and time are automatic, update the VPN client, reboot, and allow UDP 1194 on the firewall.";
    expect(checkCitation(draft, vpn)).toMatchObject({ grounded: true, articleId: 2 });
  });

  it("does not ground an answer the article never covers", () => {
    const draft =
      "Reinstall the operating system and replace the network adapter; call your internet provider and request a new router.";
    expect(checkCitation(draft, vpn).grounded).toBe(false);
  });

  it("says so plainly when nothing matches", () => {
    const result = checkCitation("Try the steps", null);
    expect(result).toMatchObject({ grounded: false, articleId: null });
    expect(result.verdict).toMatch(/no matching article/i);
  });
});
