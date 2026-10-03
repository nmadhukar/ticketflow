import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as authHooks from "@/hooks/useAuth";
import { useAuth } from "@/hooks/useAuth";
import { getQueryFn } from "@/lib/queryClient";
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

describe("ForcedPasswordChange sign out (real query client)", () => {
  let goHome: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    // jsdom cannot navigate; the spy records where the screen sends the browser.
    goHome = jest.spyOn(authHooks, "goHome").mockImplementation(() => undefined);
  });
  afterEach(() => goHome.mockRestore());

  function Harness() {
    const { user, isAuthenticated } = useAuth();
    if (!isAuthenticated) return <div>signed out</div>;
    return (user as any)?.mustChangePassword ? <ForcedPasswordChange /> : <div>app</div>;
  }

  function renderHarness() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: getQueryFn({ on401: "throw" }) } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>
    );
    return queryClient;
  }

  const unauthorized = {
    ok: false,
    status: 401,
    headers: { get: () => "application/json" },
    json: async () => ({ message: "Not authenticated" }),
  };

  it("leaves the forced screen after Sign out even though /api/auth/user now answers 401", async () => {
    let signedIn = true;
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url === "/api/auth/logout") {
        signedIn = false;
        return { ok: true, json: async () => ({}) };
      }
      if (url === "/api/auth/user") {
        return signedIn
          ? { ok: true, json: async () => ({ id: "1", role: "agent", mustChangePassword: true }) }
          : unauthorized;
      }
      throw new Error("unexpected " + url);
    });
    const queryClient = renderHarness();
    fireEvent.click(await screen.findByRole("button", { name: /sign out/i }));
    expect(await screen.findByText("signed out")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /change password/i })).toBeNull();
    expect(queryClient.getQueryData(["/api/auth/user"])).toBeNull();
    const calls = (global.fetch as jest.Mock).mock.calls.filter((c) => c[0] === "/api/auth/logout");
    expect(calls).toHaveLength(1);
    expect(calls[0][1].method).toBe("POST");
    // The same exit as the header menu: one full load of "/", so a deep path does not land on NotFound.
    expect(goHome).toHaveBeenCalledTimes(1);
  });

  it("a failed sign out shows the error, stays on the screen and does not reject unhandled", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url === "/api/auth/logout") throw new Error("network down");
      return { ok: true, json: async () => ({ id: "1", role: "agent", mustChangePassword: true }) };
    });
    renderHarness();
    fireEvent.click(await screen.findByRole("button", { name: /sign out/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/network down/);
    expect(screen.getByRole("button", { name: /change password/i })).toBeTruthy();
    expect(goHome).not.toHaveBeenCalled();
    // Give a stray rejected promise the chance to surface. Jest itself fails the test on an
    // unhandled rejection, so no listener or assertion is needed here.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});
