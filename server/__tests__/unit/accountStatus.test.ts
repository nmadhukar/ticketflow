import { loginBlockReason } from "../../services/auth/accountStatus";

describe("loginBlockReason (SSO callback gate)", () => {
  it("allows active, approved accounts", () => {
    expect(loginBlockReason({ isActive: true, isApproved: true })).toBeNull();
  });
  it("blocks deactivated accounts, even if approved", () => {
    expect(loginBlockReason({ isActive: false, isApproved: true })).toBe("account_inactive");
  });
  it("blocks accounts awaiting approval", () => {
    expect(loginBlockReason({ isActive: true, isApproved: false })).toBe("pending_approval");
    expect(loginBlockReason({ isActive: true, isApproved: null })).toBe("pending_approval");
  });
});
