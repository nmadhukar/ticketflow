import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TaskModal } from "../task-modal";
import { vi } from "vitest";

// Mock API calls
const mockMutate = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  ...vi.importActual("@tanstack/react-query"),
  useMutation: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
  useQuery: () => ({
    data: [],
    isLoading: false,
  }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("TaskModal Component", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    mode: "create" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render create mode correctly", () => {
    render(<TaskModal {...defaultProps} />, { wrapper: createWrapper() });

    expect(screen.getByText("Create New Ticket")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
    expect(screen.getByText("Create Ticket")).toBeInTheDocument();
  });

  it("should render edit mode correctly", () => {
    const task = {
      id: 1,
      ticketNumber: "TKT-2024-0001",
      title: "Test Ticket",
      description: "Test Description",
      status: "open" as const,
      priority: "medium" as const,
      severity: "normal" as const,
      category: "bug" as const,
    };

    render(<TaskModal {...defaultProps} mode="edit" task={task} />, {
      wrapper: createWrapper(),
    });

    expect(screen.getByText("Edit Ticket TKT-2024-0001")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Test Ticket")).toBeInTheDocument();
    expect(screen.getByText("Save Changes")).toBeInTheDocument();
  });

  it("should validate required fields", async () => {
    const user = userEvent.setup();
    render(<TaskModal {...defaultProps} />, { wrapper: createWrapper() });

    // Try to submit without filling required fields
    const submitButton = screen.getByText("Create Ticket");
    await user.click(submitButton);

    // Should show validation errors
    await waitFor(() => {
      expect(screen.getByText(/title is required/i)).toBeInTheDocument();
    });
  });

  it("should handle form submission", async () => {
    const user = userEvent.setup();
    render(<TaskModal {...defaultProps} />, { wrapper: createWrapper() });

    // Fill in the form
    await user.type(screen.getByLabelText("Title"), "New Bug Report");
    await user.type(
      screen.getByLabelText("Description"),
      "Description of the bug"
    );

    // Select priority
    const priorityButton = screen.getByRole("combobox", { name: /priority/i });
    await user.click(priorityButton);
    await user.click(screen.getByText("High"));

    // Submit form
    await user.click(screen.getByText("Create Ticket"));

    // Check that mutation was called
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New Bug Report",
        description: "Description of the bug",
        priority: "high",
      })
    );
  });

  it("should switch between tabs", async () => {
    const user = userEvent.setup();
    const task = {
      id: 1,
      ticketNumber: "TKT-2024-0001",
      title: "Test Ticket",
      description: "Test Description",
      status: "open" as const,
      priority: "medium" as const,
      severity: "normal" as const,
      category: "bug" as const,
    };

    render(<TaskModal {...defaultProps} mode="view" task={task} />, {
      wrapper: createWrapper(),
    });

    // Should show details tab by default
    expect(screen.getByText("Test Description")).toBeInTheDocument();

    // Click on comments tab
    await user.click(screen.getByText("Comments"));

    // Should show comments section
    expect(screen.getByPlaceholderText(/add a comment/i)).toBeInTheDocument();
  });

  it("should handle status change in view mode", async () => {
    const user = userEvent.setup();
    const task = {
      id: 1,
      ticketNumber: "TKT-2024-0001",
      title: "Test Ticket",
      description: "Test Description",
      status: "open" as const,
      priority: "medium" as const,
      severity: "normal" as const,
      category: "bug" as const,
    };

    render(<TaskModal {...defaultProps} mode="view" task={task} />, {
      wrapper: createWrapper(),
    });

    // Click on status dropdown
    const statusButton = screen.getByRole("button", { name: /open/i });
    await user.click(statusButton);

    // Select new status
    await user.click(screen.getByText("In Progress"));

    // Should call mutation
    expect(mockMutate).toHaveBeenCalledWith({
      id: 1,
      updates: { status: "in_progress" },
    });
  });

  it("should close modal when cancel is clicked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<TaskModal {...defaultProps} onOpenChange={onOpenChange} />, {
      wrapper: createWrapper(),
    });

    await user.click(screen.getByText("Cancel"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("should display file attachments in view mode", () => {
    const task = {
      id: 1,
      ticketNumber: "TKT-2024-0001",
      title: "Test Ticket",
      description: "Test Description",
      status: "open" as const,
      priority: "medium" as const,
      severity: "normal" as const,
      category: "bug" as const,
      attachments: [
        {
          id: 1,
          fileName: "screenshot.png",
          fileType: "image/png",
          fileSize: 123456,
        },
      ],
    };

    render(<TaskModal {...defaultProps} mode="view" task={task} />, {
      wrapper: createWrapper(),
    });

    expect(screen.getByText("screenshot.png")).toBeInTheDocument();
  });
});
