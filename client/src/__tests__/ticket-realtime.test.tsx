import { act, renderHook } from "@testing-library/react";
import { QueryObserver } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useWebSocket } from "@/hooks/useWebSocket";

const mockToast = jest.fn();
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true }) }));

class TestSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static instance: TestSocket;
  readyState = TestSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { TestSocket.instance = this; }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  send() {}
  ticketUpdated(ticketId: number) { this.onmessage?.({ data: JSON.stringify({ type: "ticket_updated", ticketId }) }); }
}

const originalWebSocket = globalThis.WebSocket;
beforeEach(() => {
  queryClient.clear();
  globalThis.WebSocket = TestSocket as unknown as typeof WebSocket;
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  queryClient.clear();
  globalThis.WebSocket = originalWebSocket;
  jest.restoreAllMocks();
});

it("invalidates filtered queues and both ticket key formats without touching another ticket", async () => {
  const matchingKeys = [
    ["/api/tasks"], ["/api/tasks?status=open&limit=20&offset=0"],
    ["/api/tasks/my?priority=urgent&limit=20&offset=20"], ["/api/tasks/my-groups"],
    ["/api/tasks/7"], ["/api/tasks/7/comments"], ["/api/tasks/7/history"],
    ["/api/tasks", 7], ["/api/tasks", "7", "comments"],
  ];
  const unrelatedKeys = [["/api/tasks/70"], ["/api/tasks", 70], ["/api/users"]];
  for (const key of [...matchingKeys, ...unrelatedKeys]) queryClient.setQueryData(key, []);
  const { unmount } = renderHook(() => useWebSocket());
  await act(async () => TestSocket.instance.ticketUpdated(7));
  for (const key of matchingKeys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  for (const key of unrelatedKeys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
  unmount();
});

it("refreshes the active filtered list when a visible ticket changes", async () => {
  const key = ["/api/tasks?status=open&limit=20&offset=0"];
  queryClient.setQueryData(key, [{ id: 7, status: "open" }]);
  const fetchList = jest.fn(async () => []);
  const observer = new QueryObserver(queryClient, { queryKey: key, queryFn: fetchList });
  const unsubscribe = observer.subscribe(() => {});
  const { unmount } = renderHook(() => useWebSocket());
  await act(async () => TestSocket.instance.ticketUpdated(7));
  expect(fetchList).toHaveBeenCalledTimes(1);
  expect(queryClient.getQueryData(key)).toEqual([]);
  unsubscribe();
  unmount();
});
