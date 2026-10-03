import { toPublicUser, PUBLIC_USER_FIELDS } from "../../utils/publicUser";

describe("toPublicUser", () => {
  const row = {
    id: "u1",
    email: "a@b.test",
    password: "hash",
    firstName: "A",
    lastName: "B",
    profileImageUrl: null,
    role: "admin",
    phone: "1",
    isActive: true,
    isApproved: true,
    passwordResetToken: "tok",
    passwordResetExpires: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    somethingAddedLater: "secret",
  };

  it("keeps only allow-listed fields", () => {
    const out = toPublicUser(row);
    expect(Object.keys(out).sort()).toEqual(
      [...PUBLIC_USER_FIELDS].sort()
    );
    expect(out).not.toHaveProperty("password");
    expect(out).not.toHaveProperty("passwordResetToken");
    expect(out).not.toHaveProperty("passwordResetExpires");
    expect(out).not.toHaveProperty("somethingAddedLater");
  });

  it("does not invent fields that were not selected", () => {
    expect(toPublicUser({ id: "u1", password: "x" })).toEqual({ id: "u1" });
  });
});
