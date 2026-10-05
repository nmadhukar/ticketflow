import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { spawnSync } from "child_process";
import { buildSync } from "esbuild";
import { WORKER_BUNDLE_NAME } from "../../services/documents/extractText";
import { makeDocx, makePdf } from "../utils/documentFiles";

/**
 * Review I1: document text is parsed in a worker thread, from its own file. The production build
 * must ship that file next to dist/index.js, and the bundled server must find it there whatever
 * the working directory. This builds a small entry that calls extractDocumentText exactly as
 * `npm run build` builds the server (esbuild, ESM, packages external) plus the worker as the
 * build script builds it, then runs it with plain Node from another directory on a real .docx and
 * a real .pdf.
 */

const root = path.resolve(__dirname, "../../..");
const buildScript: string = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts.build;
const WORKER_SOURCE = "server/services/documents/extractWorker.mjs";

describe("the document extraction worker in the production build", () => {
  it("npm run build bundles the worker to dist/" + "documentExtractWorker.mjs", () => {
    expect(buildScript).toContain(`esbuild ${WORKER_SOURCE} --platform=node --packages=external --bundle --format=esm --outfile=dist/${WORKER_BUNDLE_NAME}`);
  });

  it("a bundled entry in <dir>/dist finds <dir>/dist/" + "documentExtractWorker.mjs and extracts a docx and a pdf, run from another cwd", async () => {
    const work = mkdtempSync(path.join(root, ".tmp-extract-worker-"));
    try {
      const dist = path.join(work, "dist");
      mkdirSync(dist);
      const entry = path.join(work, "probe.ts");
      const extractText = path.join(root, "server/services/documents/extractText.ts").replace(/\\/g, "/");
      writeFileSync(
        entry,
        [
          `import { readFileSync } from "node:fs";`,
          `import { extractDocumentText, extractWorkerFile } from "${extractText}";`,
          `const docx = await extractDocumentText({ filename: "a.docx", data: readFileSync(process.env.PROBE_DOCX!) });`,
          `const pdf = await extractDocumentText({ filename: "a.pdf", data: readFileSync(process.env.PROBE_PDF!) });`,
          `console.log(JSON.stringify({ worker: extractWorkerFile(), docx, pdf }));`,
        ].join("\n")
      );
      const common = { bundle: true, platform: "node" as const, format: "esm" as const, packages: "external" as const, logLevel: "error" as const };
      buildSync({ ...common, entryPoints: [entry], outfile: path.join(dist, "index.js") });
      buildSync({ ...common, entryPoints: [path.join(root, WORKER_SOURCE)], outfile: path.join(dist, WORKER_BUNDLE_NAME) });
      writeFileSync(path.join(work, "a.docx"), await makeDocx(["Built docx: DoseSpot clinic key"]));
      writeFileSync(path.join(work, "a.pdf"), makePdf("Built pdf text"));

      const res = spawnSync(process.execPath, [path.join(dist, "index.js")], {
        cwd: tmpdir(),
        encoding: "utf8",
        env: { ...process.env, PROBE_DOCX: path.join(work, "a.docx"), PROBE_PDF: path.join(work, "a.pdf") },
        timeout: 60000,
      });
      expect({ status: res.status, stderr: res.stderr }).toEqual({ status: 0, stderr: "" });
      const out = JSON.parse(res.stdout.trim().split("\n").pop()!);
      expect(out).toEqual({ worker: path.join(dist, WORKER_BUNDLE_NAME), docx: "Built docx: DoseSpot clinic key", pdf: "Built pdf text" });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);
});
