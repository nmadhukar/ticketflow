import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
  permissions: {},
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
  return { onClose };
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

  it("calls onClose when Cancel is clicked", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText("tickets:modal.buttons.cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("blocks submit and reports a missing title", async () => {
    renderModal();

    fireEvent.click(screen.getByText("tickets:modal.buttons.create"));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Ticket title is required", variant: "destructive" })
    );
    expect(mockApiRequest).not.toHaveBeenCalledWith("POST", "/api/tasks", expect.anything());
  });

  it("blocks submit and reports a missing category once a title is entered", async () => {
    renderModal();

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
