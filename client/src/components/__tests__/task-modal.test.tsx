import React from "react";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TaskModal from "../task-modal";

const mockApiRequest = jest.fn();
const mockToast = jest.fn();

jest.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1", role: "admin" }, isAuthenticated: true }),
}));
// Translation keys are asserted as-is; no i18n bootstrap needed.
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// Radix Select needs pointer-event APIs jsdom lacks; a native select keeps the
// modal's own logic (value, onValueChange) under test.
jest.mock("@/components/ui/select", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, no-useless-assignment -- jest.mock factories are hoisted above imports; React is needed by the JSX below
  const React = require("react");
  return {
    Select: ({ value, onValueChange, children }: any) => (
      <select value={value} onChange={(e) => onValueChange(e.target.value)}>
        {children}
      </select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => <>{children}</>,
    SelectItem: ({ value }: any) => <option value={value}>{value}</option>,
  };
});

const META = {
  departments: [],
  teams: [],
  assignableUsers: [],
  categories: ["bug", "support"],
  priorities: ["low", "medium", "high"],
  permissions: { allowedFields: ["title", "description", "category", "priority", "notes", "dueDate"], allowedAssigneeTypes: ["user", "team"] },
};

function json(body: unknown) {
  return { json: async () => body };
}

function renderModal(props: Partial<React.ComponentProps<typeof TaskModal>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = jest.fn();
  render(
    <QueryClientProvider client={client}>
      <TaskModal isOpen onClose={onClose} {...props} />
    </QueryClientProvider>
  );
  return { onClose, client };
}

describe("TaskModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url === "/api/tickets/meta") return json(META);
      if (method === "POST" && url === "/api/tasks") return json({ id: 1, ticketNumber: "TKT-1" });
      throw new Error(`unexpected ${method} ${url}`);
    });
  });

  it("renders the create form when open", async () => {
    renderModal();

    expect(screen.getByText("tickets:modal.createTitle")).toBeInTheDocument();
    expect(screen.getByLabelText("tickets:modal.fields.taskTitle")).toBeInTheDocument();
    expect(screen.getByLabelText("tickets:modal.fields.description")).toBeInTheDocument();
    expect(screen.getByText("tickets:modal.buttons.create")).toBeInTheDocument();
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalledWith("GET", "/api/tickets/meta"));
  });

  it("renders nothing when closed", () => {
    renderModal({ isOpen: false });
    expect(screen.queryByText("tickets:modal.createTitle")).not.toBeInTheDocument();
  });

  it("blocks submission until metadata loads and offers retry after failure", async () => {
    mockApiRequest.mockRejectedValueOnce(new Error("Offline"));
    renderModal();
    expect(screen.getByText("tickets:modal.buttons.create")).toBeDisabled();
    const retry = await screen.findByRole("button", { name: "Retry ticket form" });
    expect(screen.getByText("tickets:modal.buttons.create")).toBeDisabled();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText("tickets:modal.buttons.create")).toBeEnabled());
  });

  it("waits for edit permissions and details, then preserves edits across metadata refresh", async () => {
    const task = { id: 7, title: "Original title", description: "", category: "bug", priority: "medium", status: "open" };
    let resolveMeta!: (value: unknown) => void;
    mockApiRequest.mockImplementation((method: string, url: string) => {
      if (url === "/api/tickets/7/meta") return new Promise((resolve) => { resolveMeta = resolve; });
      if (url === "/api/tasks/7") return Promise.resolve(json(task));
      throw new Error(`unexpected ${method} ${url}`);
    });
    const { client } = renderModal({ task });
    expect(screen.getByLabelText("tickets:modal.fields.taskTitle")).toHaveAttribute("readonly");
    await act(async () => resolveMeta(json(META)));
    const title = screen.getByLabelText("tickets:modal.fields.taskTitle");
    await waitFor(() => expect(title).not.toHaveAttribute("readonly"));
    fireEvent.change(title, { target: { value: "My unsaved change" } });
    await act(async () => { client.setQueryData(["ticket-meta", { id: 7 }], { ...META, teams: [{ id: 1, name: "Support" }] }); });
    await act(async () => { client.setQueryData(["/api/tasks/7"], { ...task, title: "Background update" }); });
    expect(title).toHaveValue("My unsaved change");
  });

  it("honors edit metadata even for an admin and only sends permitted fields", async () => {
    const task = { id: 7, title: "Original title", description: "", category: "bug", priority: "medium", status: "open", notes: "Original note" };
    mockApiRequest.mockImplementation(async (method: string, url: string) => {
      if (url === "/api/tickets/7/meta") return json({ ...META, permissions: { allowedFields: ["notes"], allowedAssigneeTypes: [] } });
      if (url === "/api/tasks/7") return json(task);
      throw new Error(`unexpected ${method} ${url}`);
    });
    renderModal({ task });
    const save = screen.getByText("tickets:modal.buttons.update");
    await waitFor(() => expect(save).toBeEnabled());
    expect(screen.getByLabelText("tickets:modal.fields.taskTitle")).toHaveAttribute("readonly");
    fireEvent.change(screen.getByRole("textbox", { name: "tickets:modal.sections.notes" }), { target: { value: "" } });
    fireEvent.click(save);
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalledWith("PATCH", "/api/tasks/7", { notes: "" }));
  });

  it("calls onClose when Cancel is clicked", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText("tickets:modal.buttons.cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("blocks submit and reports a missing title", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText("tickets:modal.buttons.create")).toBeEnabled());

    fireEvent.click(screen.getByText("tickets:modal.buttons.create"));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Ticket title is required", variant: "destructive" })
    );
    expect(mockApiRequest).not.toHaveBeenCalledWith("POST", "/api/tasks", expect.anything());
  });

  it("blocks submit and reports a missing category once a title is entered", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText("tickets:modal.buttons.create")).toBeEnabled());

    fireEvent.change(screen.getByLabelText("tickets:modal.fields.taskTitle"), {
      target: { value: "Printer is on fire" },
    });
    fireEvent.click(screen.getByText("tickets:modal.buttons.create"));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Ticket category is required" })
    );
    expect(mockApiRequest).not.toHaveBeenCalledWith("POST", "/api/tasks", expect.anything());
  });

  it("posts the entered values to /api/tasks on a valid submit", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText("tickets:modal.buttons.create")).toBeEnabled());

    fireEvent.change(screen.getByLabelText("tickets:modal.fields.taskTitle"), {
      target: { value: "  Printer is on fire " },
    });
    fireEvent.change(screen.getByLabelText("tickets:modal.fields.description"), {
      target: { value: "Third floor" },
    });
    const categorySelect = await waitFor(() => {
      const select = screen
        .getAllByRole("combobox")
        .find((el) => within(el).queryByText("bug"));
      expect(select).toBeDefined();
      return select as HTMLElement;
    });
    fireEvent.change(categorySelect, { target: { value: "bug" } });

    fireEvent.click(screen.getByText("tickets:modal.buttons.create"));

    await waitFor(() =>
      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/tasks",
        expect.objectContaining({
          title: "Printer is on fire", // trimmed
          description: "Third floor",
          category: "bug",
          priority: "medium",
        })
      )
    );
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });
});
