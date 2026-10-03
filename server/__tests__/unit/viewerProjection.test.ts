import { projectUserForViewer, CUSTOMER_VISIBLE_USER_FIELDS } from "../../utils/publicUser";
import {
  AI_SYSTEM_USER_ID,
  LEGACY_SYSTEM_USER_ID,
  SYSTEM_ACCOUNT_IDS,
  isSystemAccountId,
} from "../../utils/aiSystemUserId";

const staffRow = {
  id: "u1",
  email: "staff@example.test",
  firstName: "Sam",
  lastName: "Staff",
  role: "admin",
  phone: "555-0100",
  isActive: true,
  isApproved: true,
  profileImageUrl: null,
  password: "must-never-appear",
  passwordResetToken: "tok",
};

describe("projectUserForViewer", () => {
  it("admin and manager viewers get the public projection with phone (and never a secret)", () => {
    for (const role of ["admin", "manager"]) {
      const out = projectUserForViewer({ id: "viewer", role }, staffRow) as Record<string, unknown>;
      expect(out.email).toBe("staff@example.test");
      expect(out.phone).toBe("555-0100");
      expect(out).not.toHaveProperty("password");
      expect(out).not.toHaveProperty("passwordResetToken");
    }
  });

  it("an agent (and the legacy role 'user') gets the projection without phone, except on their own row", () => {
    for (const role of ["agent", "user"]) {
      const other = projectUserForViewer({ id: "viewer", role }, staffRow) as Record<string, unknown>;
      expect(other.email).toBe("staff@example.test");
      expect(other).not.toHaveProperty("phone");
      expect(other).not.toHaveProperty("password");
      const own = projectUserForViewer({ id: "u1", role }, staffRow) as Record<string, unknown>;
      expect(own.phone).toBe("555-0100");
      expect(own).not.toHaveProperty("password");
    }
  });

  it("a customer gets id, name and picture only", () => {
    const out = projectUserForViewer({ id: "c1", role: "customer" }, staffRow);
    expect(Object.keys(out).sort()).toEqual([...CUSTOMER_VISIBLE_USER_FIELDS].sort());
    expect(JSON.stringify(out)).not.toMatch(/staff@example|555-0100|admin/);
  });

  it("an unknown or missing viewer role is treated as a customer", () => {
    for (const role of ["superuser", "", null, undefined, 7]) {
      expect(Object.keys(projectUserForViewer({ id: "u1", role }, staffRow)).sort()).toEqual(
        [...CUSTOMER_VISIBLE_USER_FIELDS].sort()
      );
    }
    expect(Object.keys(projectUserForViewer(undefined, staffRow)).sort()).toEqual(
      [...CUSTOMER_VISIBLE_USER_FIELDS].sort()
    );
  });
});

describe("system accounts", () => {
  it("one list names both the AI user and the legacy system user", () => {
    expect([...SYSTEM_ACCOUNT_IDS].sort()).toEqual([AI_SYSTEM_USER_ID, LEGACY_SYSTEM_USER_ID].sort());
    expect(isSystemAccountId(AI_SYSTEM_USER_ID)).toBe(true);
    expect(isSystemAccountId("system")).toBe(true);
    expect(isSystemAccountId("someone-else")).toBe(false);
    expect(isSystemAccountId(null)).toBe(false);
    expect(isSystemAccountId(undefined)).toBe(false);
  });
});
