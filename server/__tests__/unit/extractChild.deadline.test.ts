import { mkdtempSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { inflatingPdf } from "../utils/documentFiles";

/**
 * Review N8: the extractor enforces its own deadline. The 20 s limit used to live only in the
 * parent, so when the server exited mid-parse and node was not PID 1 (npm run dev, a supervisor
 * that does not kill the process group), the reparented extractor ran on. A stand-in parent forks
 * the real extractor on a slow job (a PDF that takes PDF.js about 8 s to inflate, no RSS limit)
 * with a 1.5 s deadline, prints the child's pid, and then either stays connected but never stops
 * it, or exits at once. Either way the child must be gone soon after its deadline.
 */

const root = path.resolve(__dirname, "../../..");
const CHILD = path.join(root, "server/services/documents/extractChild.mjs");

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function startParent(work: string, bombFile: string, exitAfterMs: number): Promise<{ parent: ChildProcess; childPid: number }> {
  const parentFile = path.join(work, `parent-${exitAfterMs}.mjs`);
  writeFileSync(
    parentFile,
    [
      `import { fork } from "node:child_process";`,
      `import { readFileSync } from "node:fs";`,
      `const child = fork(${JSON.stringify(CHILD)}, [], { stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "advanced", execArgv: ["--max-old-space-size=256"] });`,
      `child.send({ type: "pdf", bytes: readFileSync(${JSON.stringify(bombFile)}), maxChars: 1000000, maxPdfPages: 500, docxBudget: 52428800, rssLimitMb: 0, deadlineMs: 1500 });`,
      `console.log(String(child.pid));`,
      // The parent never kills the child; it just leaves after exitAfterMs.
      `setTimeout(() => process.exit(0), ${exitAfterMs});`,
    ].join("\n")
  );
  const parent = spawn(process.execPath, [parentFile], { stdio: ["ignore", "pipe", "ignore"] });
  const childPid = await new Promise<number>((resolve) => {
    let out = "";
    parent.stdout!.on("data", (c: Buffer) => {
      out += c.toString();
      if (out.includes("\n")) resolve(Number(out.trim()));
    });
    parent.on("exit", () => resolve(Number(out.trim())));
  });
  return { parent, childPid };
}

async function goneWithin(pid: number, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (alive(pid) && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
  return !alive(pid);
}

describe("the extractor's own deadline (review N8)", () => {
  let work = "";
  let bombFile = "";
  const pids: number[] = [];
  beforeAll(async () => {
    work = mkdtempSync(path.join(root, ".tmp-extract-child-"));
    bombFile = path.join(work, "bomb.pdf");
    writeFileSync(bombFile, await inflatingPdf(1024 * 1024 * 1024 + 1));
  }, 120000);
  afterAll(() => {
    for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
    rmSync(work, { recursive: true, force: true });
  });

  it("with a parent that stays connected but never stops it, the extractor kills itself at its deadline", async () => {
    const { parent, childPid } = await startParent(work, bombFile, 10000);
    pids.push(childPid, parent.pid!);
    expect(childPid).toBeGreaterThan(0);
    // 1.5 s deadline from the job; allow for start-up and the watchdog thread.
    expect(await goneWithin(childPid, 4000)).toBe(true);
    // The parent was still there all along: the child stopped by itself.
    expect(alive(parent.pid!)).toBe(true);
    parent.kill("SIGKILL");
  }, 60000);

  it("when the parent exits mid-parse, the orphaned extractor is gone within its deadline", async () => {
    const { parent, childPid } = await startParent(work, bombFile, 200);
    pids.push(childPid, parent.pid!);
    expect(childPid).toBeGreaterThan(0);
    expect(await goneWithin(childPid, 4000)).toBe(true);
  }, 60000);
});
