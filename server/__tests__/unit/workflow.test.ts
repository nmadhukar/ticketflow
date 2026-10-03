import { assertTransition, allowedNextStatuses, STAFF_TRANSITIONS, STATUSES } from "../../permissions/workflow";
import { HttpError } from "../../http/errors";

function outcome(fn: () => void): string {
  try {
    fn();
    return "ok";
  } catch (e) {
    return e instanceof HttpError ? `${e.status} ${e.code}` : "other";
  }
}

describe("ticket workflow", () => {
  it("every staff role follows STAFF_TRANSITIONS for every status pair", () => {
    for (const role of ["admin", "manager", "agent", "user"]) {
      for (const from of STATUSES) {
        for (const to of STATUSES) {
          const expected =
            from === to || STAFF_TRANSITIONS[from].includes(to) ? "ok" : "409 invalid_transition";
          expect([role, from, to, outcome(() => assertTransition(role, from, to, false))]).toEqual([
            role,
            from,
            to,
            expected,
          ]);
        }
      }
    }
  });

  it("staff may close from any open state, and resolved -> on_hold is refused", () => {
    expect(outcome(() => assertTransition("agent", "open", "closed", false))).toBe("ok");
    expect(outcome(() => assertTransition("agent", "on_hold", "closed", false))).toBe("ok");
    expect(outcome(() => assertTransition("agent", "resolved", "on_hold", false))).toBe("409 invalid_transition");
    expect(outcome(() => assertTransition("manager", "closed", "resolved", false))).toBe("409 invalid_transition");
  });

  it("a customer may only reopen their own resolved or closed ticket", () => {
    expect(outcome(() => assertTransition("customer", "closed", "open", true))).toBe("ok");
    expect(outcome(() => assertTransition("customer", "resolved", "open", true))).toBe("ok");
    expect(outcome(() => assertTransition("customer", "closed", "open", false))).toBe("403 forbidden");
    expect(outcome(() => assertTransition("customer", "open", "closed", true))).toBe("403 forbidden");
    expect(outcome(() => assertTransition("customer", "open", "in_progress", true))).toBe("403 forbidden");
    expect(outcome(() => assertTransition("customer", "resolved", "closed", true))).toBe("403 forbidden");
  });

  it("a stored status outside the vocabulary: staff move it anywhere valid, a customer gets nothing, nothing throws", () => {
    const legacy = "pending" as any;
    for (const to of STATUSES) expect(outcome(() => assertTransition("agent", legacy, to, false))).toBe("ok");
    expect(allowedNextStatuses("admin", legacy, false)).toEqual([...STATUSES]);
    expect(outcome(() => assertTransition("customer", legacy, "open", true))).toBe("403 forbidden");
    expect(allowedNextStatuses("customer", legacy, true)).toEqual([]);
  });

  it("an unknown role is refused, never treated as staff", () => {
    expect(outcome(() => assertTransition("superuser", "open", "closed", true))).toBe("403 forbidden");
    expect(allowedNextStatuses(null, "open", true)).toEqual([]);
  });
});
