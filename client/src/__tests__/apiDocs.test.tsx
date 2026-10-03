import { render, screen, fireEvent } from "@testing-library/react";
import ApiDocs from "@/pages/api-docs";

/**
 * P2: the /api-docs page loads and lists the ticket endpoints. The route is registered
 * outside the sign-in guard in App.tsx (it is static documentation with no data of its
 * own), so it renders the same for a signed-in user.
 */
describe("API docs page (P2)", () => {
  beforeEach(() => {
    render(<ApiDocs />);
  });

  // Radix tabs switch on mouse down, not click.
  const openTab = (name: string) => fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });

  it("loads with its heading, the base URL and how to authenticate", () => {
    expect(screen.getByRole("heading", { name: "API Documentation" })).toBeTruthy();
    expect(document.body.textContent).toContain(`${window.location.origin}/api`);
    expect(document.body.textContent).toContain("X-API-Key");
  });

  it("offers the Authentication, Tasks, Teams and Webhooks sections", () => {
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Authentication", "Tasks", "Teams", "Webhooks"]);
  });

  it("the Tasks section lists the ticket endpoints: list, create, get, update, comment and delete", () => {
    openTab("Tasks");
    const text = document.body.textContent ?? "";
    for (const title of ["List Tasks", "Create Task", "Get Task", "Update Task", "Add Comment", "Delete Task"]) {
      expect(text).toContain(title);
    }

    const pairs = Array.from(document.querySelectorAll("code"))
      .map((c) => c.textContent)
      .filter((t): t is string => !!t && t.startsWith("/api/tasks"));
    expect(pairs).toEqual([
      "/api/tasks",
      "/api/tasks",
      "/api/tasks/:id",
      "/api/tasks/:id",
      "/api/tasks/:id/comments",
      "/api/tasks/:id",
    ]);

    const methods = screen.getAllByText(/^(GET|POST|PATCH|PUT|DELETE)$/).map((b) => b.textContent);
    expect(methods).toEqual(["GET", "POST", "GET", "PATCH", "POST", "DELETE"]);
  });

  it("documents the comment body ({content}) and that delete is admin only", () => {
    openTab("Tasks");
    const text = document.body.textContent ?? "";
    expect(text).toContain('"content"');
    expect(text).toMatch(/admin/i);
  });

  it("documents the ticket create body the server accepts (title, category, priority) and PATCH, not PUT", () => {
    openTab("Tasks");
    const text = document.body.textContent ?? "";
    expect(text).toContain('"title"');
    expect(text).toContain('"category"');
    expect(text).toContain('"priority"');
    expect(screen.queryByText("PUT")).toBeNull();
  });
});
