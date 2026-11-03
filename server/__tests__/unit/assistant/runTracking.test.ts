import { Subject } from "rxjs";
import { LruMap, observe, RunEndings, TrackedRunner, type RunnerLike, type RunSummary } from "../../../assistant/runTracking";

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

function tracked(userId = "u1", now = () => 1000) {
  const endings = new RunEndings();
  const finished: RunSummary[] = [];
  const key = RunEndings.key(userId, "t1", "r1")!;
  endings.expect(key, (s) => finished.push(s));
  const { runner, streams } = fakeRunner();
  return { endings, finished, key, streams, tracker: new TrackedRunner(runner, endings, userId, now) };
}

describe("run endings", () => {
  it("finishes an assistant run when its agent run completes, with what happened in it", () => {
    let clock = 1000;
    const { finished, streams, tracker } = tracked("u1", () => clock);
    tracker.run(request("t1", "r1")).subscribe();
    streams[0].next({ type: "TOOL_CALL_START", toolCallName: "ticketflow_get_ticket" });
    streams[0].next({ type: "TOOL_CALL_START", toolCallName: "ticketflow_propose_comment" });
    streams[0].next({ type: "TEXT_MESSAGE_CONTENT", delta: "never read" });
    expect(finished).toEqual([]);
    clock = 4500;
    streams[0].next({ type: "RUN_FINISHED", usage: [{ inputTokens: 100, outputTokens: 20 }, { inputTokens: 300, outputTokens: 5 }] });
    streams[0].complete();
    expect(finished).toEqual([
      {
        status: "completed",
        errorCategory: null,
        toolNames: ["get_ticket", "propose_comment"],
        proposalCount: 1,
        inputTokens: 400,
        outputTokens: 25,
        durationMs: 3500,
      },
    ]);
  });

  it("reports a failed run (RUN_ERROR or a stream error) and a dropped one as stopped", () => {
    const failed = tracked();
    failed.tracker.run(request("t1", "r1")).subscribe();
    failed.streams[0].next({ type: "RUN_ERROR", code: "model_error", message: "provider said no" });
    failed.streams[0].complete();
    expect(failed.finished[0]).toMatchObject({ status: "failed", errorCategory: "model_error" });

    const errored = tracked();
    errored.tracker.run(request("t1", "r1")).subscribe({ error: () => {} });
    errored.streams[0].error(new Error("boom"));
    expect(errored.finished[0]).toMatchObject({ status: "failed", errorCategory: "stream_error" });

    const dropped = tracked();
    const sub = dropped.tracker.run(request("t1", "r1")).subscribe();
    sub.unsubscribe();
    expect(dropped.finished[0]).toMatchObject({ status: "stopped" });
  });

  it("once the runner has taken a run, closing the request does not finish it", () => {
    const { endings, finished, key, tracker } = tracked();
    tracker.run(request("t1", "r1")).subscribe();
    endings.release(key);
    expect(finished).toEqual([]);
  });

  it("a run the runner never picked up is finished with its request, once", () => {
    const endings = new RunEndings();
    const finish = jest.fn();
    const key = RunEndings.key("u1", "t1", "r1")!;
    endings.expect(key, finish);
    endings.release(key);
    endings.release(key);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish.mock.calls[0][0]).toMatchObject({ status: "stopped", errorCategory: "not_started" });
  });

  it("never finishes another user's run, even with the same thread and run ids", () => {
    const endings = new RunEndings();
    const finishA = jest.fn();
    endings.expect(RunEndings.key("userA", "t1", "r1")!, finishA);
    const { runner, streams } = fakeRunner();
    new TrackedRunner(runner, endings, "userB").run(request("t1", "r1")).subscribe();
    streams[0].complete();
    expect(finishA).not.toHaveBeenCalled();
    expect(RunEndings.key("u", "", "r")).toBeNull();
    expect(RunEndings.key("u", "t", undefined)).toBeNull();
  });

  it("reads only names, codes and counts: odd codes are not stored", () => {
    const s: RunSummary = { status: "stopped", errorCategory: null, toolNames: [], proposalCount: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 };
    observe(s, { type: "RUN_ERROR", code: "has spaces and <html>" });
    expect(s.errorCategory).toBe("run_error");
    observe(s, { type: "RUN_FINISHED", usage: { inputTokens: "x", outputTokens: 7 } });
    expect(s).toMatchObject({ status: "failed", inputTokens: 0, outputTokens: 7 });
  });

  it("a RUN_FINISHED that was cancelled or interrupted is a stopped run, not a completed one", () => {
    const cancelled = tracked();
    cancelled.tracker.run(request("t1", "r1")).subscribe();
    cancelled.streams[0].next({ type: "RUN_FINISHED", outcome: { type: "cancelled" } });
    cancelled.streams[0].complete();
    expect(cancelled.finished[0]).toMatchObject({ status: "stopped", errorCategory: "cancelled" });

    const interrupted = tracked();
    interrupted.tracker.run(request("t1", "r1")).subscribe();
    interrupted.streams[0].next({ type: "RUN_FINISHED", outcome: { type: "interrupt" } });
    interrupted.streams[0].complete();
    expect(interrupted.finished[0]).toMatchObject({ status: "stopped", errorCategory: "interrupted" });

    const success = tracked();
    success.tracker.run(request("t1", "r1")).subscribe();
    success.streams[0].next({ type: "RUN_FINISHED", outcome: { type: "success" } });
    success.streams[0].complete();
    expect(success.finished[0]).toMatchObject({ status: "completed", errorCategory: null });
  });

  it("keeps the model and provider the run reported in its usage", () => {
    const s: RunSummary = { status: "stopped", errorCategory: null, toolNames: [], proposalCount: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 };
    observe(s, { type: "RUN_FINISHED", usage: [{ inputTokens: 1, outputTokens: 1, provider: "openrouter", model: "openai/gpt-5-mini" }] });
    expect(s).toMatchObject({ provider: "openrouter", model: "openai/gpt-5-mini" });
  });
});

describe("LruMap", () => {
  it("drops the least recently used entry, where reading counts as use", () => {
    const map = new LruMap<string, number>(2);
    map.set("a", 1);
    map.set("b", 2);
    expect(map.get("a")).toBe(1);
    map.set("c", 3);
    expect(map.get("b")).toBeUndefined();
    expect(map.get("a")).toBe(1);
    expect(map.get("c")).toBe(3);
    expect(map.size).toBe(2);
    map.delete("a");
    expect(map.size).toBe(1);
  });
});
