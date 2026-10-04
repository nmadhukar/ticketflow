import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TaskAttachments from "../task-modal/task-attachments";

jest.mock("@/lib/queryClient", () => ({ apiRequest: async () => ({ json: async () => ({}) }) }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: "customer" } }) }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it("provides a native keyboard-operable upload button and names selected-file removal", async () => {
  const onFilesChange = jest.fn();
  render(<QueryClientProvider client={new QueryClient()}><TaskAttachments task={null} onFilesChange={onFilesChange} /></QueryClientProvider>);
  const upload = screen.getByRole("button", { name: "Choose files" });
  expect(upload.tagName).toBe("BUTTON");
  const fileInput = screen.getByLabelText("Ticket attachments") as HTMLInputElement;
  const click = jest.spyOn(fileInput, "click");
  fireEvent.click(upload);
  expect(click).toHaveBeenCalledTimes(1);
  fireEvent.change(fileInput, { target: { files: [new File(["Notes"], "notes.txt", { type: "text/plain" })] } });
  await waitFor(() => expect(onFilesChange).toHaveBeenLastCalledWith([expect.objectContaining({ name: "notes.txt" })]));
  fireEvent.click(screen.getByRole("button", { name: "Remove notes.txt" }));
  await waitFor(() => expect(onFilesChange).toHaveBeenLastCalledWith([]));
});
