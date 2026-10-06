import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { spawnSync } from "child_process";
import { buildSync } from "esbuild";
import { CHILD_BUNDLE_NAME } from "../../services/documents/extractText";
import { inflatingPdf, makeDocx, makePdf } from "../utils/documentFiles";

/**
 * Reviews I1 and N1: document text is parsed in a separate process, from its own file. The
 * production build must ship that file next to dist/index.js, and the bundled server must find it
 * there whatever the working directory. This builds a small entry that calls extractDocumentText
 * exactly as `npm run build` builds the server (esbuild, ESM, packages external) plus the
 * extractor as the build script builds it, then runs it with plain Node from another directory on
 * a real .docx, a real .pdf and a ~1 MB .pdf that inflates past 1 GB, and checks the entry
 * process itself never grew.
 */

const root = path.resolve(__dirname, "../../..");
const buildScript: string = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts.build;
const CHILD_SOURCE = "server/services/documents/extractChild.mjs";

describe("the document extractor in the production build", () => {
  it("npm run build bundles the extractor to dist/" + "documentExtractChild.mjs", () => {
    expect(buildScript).toContain(
      `esbuild ${CHILD_SOURCE} --platform=node --packages=external --bundle --format=esm --outfile=dist/${CHILD_BUNDLE_NAME}`
    );
  });

  it("a bundled entry in <dir>/dist finds <dir>/dist/" + "documentExtractChild.mjs, extracts a docx and a pdf, and survives a 1 GB pdf bomb, run from another cwd", async () => {
    const work = mkdtempSync(path.join(root, ".tmp-extract-child-"));
    try {
      const dist = path.join(work, "dist");
      mkdirSync(dist);
      const entry = path.join(work, "probe.ts");
      const extractText = path.join(root, "server/services/documents/extractText.ts").replace(/\\/g, "/");
      writeFileSync(
        entry,
        [
          `import { readFileSync } from "node:fs";`,
          `import { extractDocumentText, extractChildFile } from "${extractText}";`,
          `const start = process.memoryUsage.rss();`,
          `let peak = start;`,
          `const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage.rss()); }, 20);`,
          `const docx = await extractDocumentText({ filename: "a.docx", data: readFileSync(process.env.PROBE_DOCX!) });`,
          `const pdf = await extractDocumentText({ filename: "a.pdf", data: readFileSync(process.env.PROBE_PDF!) });`,
          `const bomb = await extractDocumentText({ filename: "b.pdf", data: readFileSync(process.env.PROBE_BOMB!) });`,
          `clearInterval(timer);`,
          `console.log(JSON.stringify({ child: extractChildFile(), docx, pdf, bomb, growthMb: Math.round((peak - start) / 1048576) }));`,
        ].join("\n")
      );
      const common = { bundle: true, platform: "node" as const, format: "esm" as const, packages: "external" as const, logLevel: "error" as const };
      buildSync({ ...common, entryPoints: [entry], outfile: path.join(dist, "index.js") });
      buildSync({ ...common, entryPoints: [path.join(root, CHILD_SOURCE)], outfile: path.join(dist, CHILD_BUNDLE_NAME) });
      writeFileSync(path.join(work, "a.docx"), await makeDocx(["Built docx: DoseSpot clinic key"]));
      writeFileSync(path.join(work, "a.pdf"), makePdf("Built pdf text"));
      writeFileSync(path.join(work, "b.pdf"), await inflatingPdf(1024 * 1024 * 1024 + 1));

      const res = spawnSync(process.execPath, [path.join(dist, "index.js")], {
        cwd: tmpdir(),
        encoding: "utf8",
        env: {
          ...process.env,
          PROBE_DOCX: path.join(work, "a.docx"),
          PROBE_PDF: path.join(work, "a.pdf"),
          PROBE_BOMB: path.join(work, "b.pdf"),
        },
        timeout: 90000,
      });
      expect(res.status).toBe(0);
      // The only stderr line is the bomb's one-line refusal, by type.
      expect(res.stderr.trim()).toMatch(/^Document text extraction failed \[(memory limit|extractor killed SIGKILL|extractor exit 1)\]$/);
      const out = JSON.parse(res.stdout.trim().split("\n").pop()!);
      expect(out).toMatchObject({
        child: path.join(dist, CHILD_BUNDLE_NAME),
        docx: "Built docx: DoseSpot clinic key",
        pdf: "Built pdf text",
        bomb: null,
      });
      expect(out.growthMb).toBeLessThan(150);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 180000);
});
