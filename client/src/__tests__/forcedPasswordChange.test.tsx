import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ForcedPasswordChange } from "@/components/forced-password-change";

global.fetch = jest.fn();

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = jest.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <ForcedPasswordChange />
    </QueryClientProvider>
  );
  return spy;
}
const fill = (cur: string, pw: string, conf: string) => {
  fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: cur } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: pw } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: conf } });
  fireEvent.click(screen.getByRole("button", { name: /change password/i }));
};

describe("ForcedPasswordChange", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does not call the server when the confirmation differs", async () => {
    setup();
    fill("Temp-pass-123", "Brand-new-pw-1", "something-else");
    expect((await screen.findByRole("alert")).textContent).toMatch(/do not match/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("posts current and new password, then refreshes the user so the app returns", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const invalidate = setup();
    fill("Temp-pass-123", "Brand-new-pw-1", "Brand-new-pw-1");
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/auth/user"] }));
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("/api/auth/change-password");
    expect(JSON.parse(init.body)).toEqual({ currentPassword: "Temp-pass-123", password: "Brand-new-pw-1" });
  });

  it("shows the server's message when the current password is wrong", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: { get: () => "application/json" },
      json: async () => ({ error: "invalid_current_password", message: "Current password is incorrect" }),
    });
    setup();
    fill("wrong", "Brand-new-pw-1", "Brand-new-pw-1");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Current password is incorrect/);
  });
});

describe("ForcedPasswordChange sign out", () => {
  beforeEach(() => jest.clearAllMocks());
  it("offers a sign-out that posts to /api/auth/logout and refreshes the user", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const invalidate = setup();
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/auth/user"] }));
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("/api/auth/logout");
    expect(init.method).toBe("POST");
  });
});
