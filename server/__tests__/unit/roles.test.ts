import { normalizeRole } from "../../permissions/roles";

describe("normalizeRole", () => {
  it.each([
    ["admin", "admin"],
    ["manager", "manager"],
    ["agent", "agent"],
    ["customer", "customer"],
    ["user", "agent"],
    ["superuser", null],
    ["Admin", null],
    ["", null],
    [null, null],
    [undefined, null],
    [42, null],
    [{ role: "admin" }, null],
  ])("%p -> %p", (input, expected) => {
    expect(normalizeRole(input)).toBe(expected);
  });
});
