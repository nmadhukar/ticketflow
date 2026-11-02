import { Subject } from "rxjs";
import { LruMap, RunEndings, TrackedRunner, type RunnerLike } from "../../../assistant/runTracking";

function fakeRunner() {
  const streams: Subject<unknown>[] = [];
  const runner: RunnerLike = {
    run: () => {
      const s = new Subject<unknown>();
      streams.push(s);
      return s.asObservable();
    },
    connect: () => new Subject<unknown>().asObservable(),
    isRunning: async () => false,
    stop: async () => true,
  };
  return { runner, streams };
}

const request = (threadId: string, runId: string) => ({ threadId, input: { threadId, runId } });

describe("run endings", () => {
  it("ends an assistant run when its agent run completes, not when it starts", () => {
    const endings = new RunEndings();
    const end = jest.fn();
    endings.expect(RunEndings.key("u1", "t1", "r1")!, end);
    const { runner, streams } = fakeRunner();
    const events = new TrackedRunner(runner, endings, "u1").run(request("t1", "r1"));
    events.subscribe();
    streams[0].next({ type: "TEXT" });
    expect(end).not.toHaveBeenCalled();
    streams[0].complete();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("ends it when the agent run fails or its stream is dropped", () => {
    for (const finish of ["error", "unsubscribe"] as const) {
      const endings = new RunEndings();
      const end = jest.fn();
      endings.expect(RunEndings.key("u1", "t1", "r1")!, end);
      const { runner, streams } = fakeRunner();
      const sub = new TrackedRunner(runner, endings, "u1").run(request("t1", "r1")).subscribe({ error: () => {} });
      if (finish === "error") streams[0].error(new Error("model failed"));
      else sub.unsubscribe();
      expect(end).toHaveBeenCalledTimes(1);
    }
  });

  it("once the runner has taken a run, closing the request does not end it", () => {
    const endings = new RunEndings();
    const end = jest.fn();
    const key = RunEndings.key("u1", "t1", "r1")!;
    endings.expect(key, end);
    const { runner } = fakeRunner();
    new TrackedRunner(runner, endings, "u1").run(request("t1", "r1")).subscribe();
    endings.release(key); // the browser's request closed; the agent run goes on
    expect(end).not.toHaveBeenCalled();
  });

  it("a run the runner never picked up ends with its request", () => {
    const endings = new RunEndings();
    const end = jest.fn();
    const key = RunEndings.key("u1", "t1", "r1")!;
    endings.expect(key, end);
    endings.release(key);
    expect(end).toHaveBeenCalledTimes(1);
    endings.release(key);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("never ends another user's run, even with the same thread and run ids", () => {
    const endings = new RunEndings();
    const endA = jest.fn();
    endings.expect(RunEndings.key("userA", "t1", "r1")!, endA);
    const { runner, streams } = fakeRunner();
    new TrackedRunner(runner, endings, "userB").run(request("t1", "r1")).subscribe();
    streams[0].complete();
    expect(endA).not.toHaveBeenCalled();
    expect(RunEndings.key("u", "", "r")).toBeNull();
    expect(RunEndings.key("u", "t", undefined)).toBeNull();
  });
});

describe("LruMap", () => {
  it("drops the least recently used entry, where reading counts as use", () => {
    const map = new LruMap<string, number>(2);
    map.set("a", 1);
    map.set("b", 2);
    expect(map.get("a")).toBe(1); // a is now the most recent
    map.set("c", 3);
    expect(map.get("b")).toBeUndefined();
    expect(map.get("a")).toBe(1);
    expect(map.get("c")).toBe(3);
    expect(map.size).toBe(2);
    map.delete("a");
    expect(map.size).toBe(1);
  });
});
