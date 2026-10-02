import { createTicketSchema, updateTicketSchema } from "../../services/tickets/schemas";
import { insertTaskSchema } from "@shared/schema";

const base = { title: "Printer jam", category: "support" };

describe("createTicketSchema", () => {
  it("accepts a minimal body and trims the title", () => {
    expect(createTicketSchema.parse({ ...base, title: "  x  " }).title).toBe("x");
  });

  it.each([
    ["missing title", { category: "bug" }],
    ["blank title", { ...base, title: "   " }],
    ["unknown category", { ...base, category: "nonsense" }],
    ["unknown priority", { ...base, priority: "critical" }],
    ["unknown severity", { ...base, severity: "huge" }],
    ["bad assigneeType", { ...base, assigneeType: "group" }],
    ["negative hours", { ...base, estimatedHours: -1 }],
    ["fractional hours", { ...base, actualHours: 1.5 }],
    ["bad dueDate", { ...base, dueDate: "not a date" }],
  ])("rejects %s", (_name, body) => {
    expect(createTicketSchema.safeParse(body).success).toBe(false);
  });

  it.each(["status", "resolvedAt", "closedAt", "createdBy", "ticketNumber", "createdAt", "id"])(
    "rejects the server-owned field %s",
    (field) => {
      expect(createTicketSchema.safeParse({ ...base, [field]: "x" }).success).toBe(false);
    }
  );

  it("reads multipart text values: numeric ids and hours, blank dueDate", () => {
    const out = createTicketSchema.parse({
      ...base,
      assigneeTeamId: "3",
      departmentId: "2",
      estimatedHours: "8",
      dueDate: "",
    });
    expect(out.assigneeTeamId).toBe(3);
    expect(out.departmentId).toBe(2);
    expect(out.estimatedHours).toBe(8);
    expect(out.dueDate).toBeNull();
  });
});

describe("updateTicketSchema", () => {
  it("accepts every status and rejects others", () => {
    for (const status of ["open", "in_progress", "on_hold", "resolved", "closed"]) {
      expect(updateTicketSchema.safeParse({ status }).success).toBe(true);
    }
    expect(updateTicketSchema.safeParse({ status: "waiting" }).success).toBe(false);
  });

  it("rejects an unknown category or priority and unknown keys", () => {
    expect(updateTicketSchema.safeParse({ category: "nonsense" }).success).toBe(false);
    expect(updateTicketSchema.safeParse({ priority: "critical" }).success).toBe(false);
    expect(updateTicketSchema.safeParse({ createdBy: "x" }).success).toBe(false);
  });
});

describe("insertTaskSchema assignee_type", () => {
  const row = { title: "t", category: "support", createdBy: "u" };
  it("takes user or team and rejects any other string", () => {
    expect(insertTaskSchema.safeParse({ ...row, assigneeType: "user" }).success).toBe(true);
    expect(insertTaskSchema.safeParse({ ...row, assigneeType: "team" }).success).toBe(true);
    expect(insertTaskSchema.safeParse({ ...row, assigneeType: "group" }).success).toBe(false);
    expect(insertTaskSchema.safeParse(row).success).toBe(true);
  });
});

describe("array and blank-id preprocessing", () => {
  it("tags accept an array or a JSON array string, and refuse a bare comma string", () => {
    expect(createTicketSchema.parse({ ...base, tags: ["a", "b"] }).tags).toEqual(["a", "b"]);
    expect(createTicketSchema.parse({ ...base, tags: '["a","b"]' }).tags).toEqual(["a", "b"]);
    expect(createTicketSchema.safeParse({ ...base, tags: "a,b" }).success).toBe(false);
    expect(createTicketSchema.safeParse({ ...base, tags: '{"a":1}' }).success).toBe(false);
    expect(createTicketSchema.safeParse({ ...base, tags: "[1,2]" }).success).toBe(false);
  });
  it("a blank assigneeId reads as absent", () => {
    expect(createTicketSchema.parse({ ...base, assigneeId: "" }).assigneeId).toBeUndefined();
    expect(updateTicketSchema.parse({ assigneeId: "" }).assigneeId).toBeUndefined();
  });
});
