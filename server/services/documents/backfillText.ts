import { and, eq, isNull, ne } from "drizzle-orm";
import { companyPolicies, helpDocuments } from "@shared/schema";
import { db } from "../../storage/db";
import { describeError } from "../../http/errors";
import {
  documentExtractionAvailable,
  extractDocumentOutcome,
  isExtractable,
  type DocumentFile,
  type ExtractOutcome,
} from "./extractText";
import { claimHelpDocumentText, claimPolicyText, settleText } from "./documentText";

/**
 * R90 backfill: documents uploaded before extraction existed get their text after the server
 * starts. server/index.ts calls startDocumentTextBackfill inside the `listen` callback, after
 * "serving on port", without waiting for it, and it never rejects.
 *
 * What protects the server (review N1/N2): every .docx and .pdf is parsed in a separate,
 * memory-limited extractor process (extractText.ts), so a hostile file kills at most that
 * process; and each row is CLAIMED ('' where extracted_text is still NULL, documentText.ts)
 * before its file is read, so a row whose parse is killed, or kills anything, is never tried
 * again: no crash loop. Rows are processed one at a time; the text is written over the claim when
 * it arrives. A row whose parse never began (the extractor was busy with uploads) is handed back
 * to NULL and counted `deferred` (review N9): the next start retries it. The log carries counts
 * and error types only.
 */

export interface BackfillCounts {
  filled: number;
  unsupported: number;
  failed: number;
  deferred: number;
}

const empty = (): BackfillCounts => ({ filled: 0, unsupported: 0, failed: 0, deferred: 0 });

interface Source {
  kind: "help" | "policy";
  list(): Promise<Array<{ id: number; filename: string; mimeType?: string | null }>>;
  claim(id: number): Promise<boolean>;
  fileData(id: number): Promise<string | undefined>;
}

const helpSource: Source = {
  kind: "help",
  list: () =>
    db
      .select({ id: helpDocuments.id, filename: helpDocuments.filename })
      .from(helpDocuments)
      .where(and(isNull(helpDocuments.extractedText), ne(helpDocuments.fileData, ""))),
  claim: claimHelpDocumentText,
  fileData: async (id) =>
    (await db.select({ fileData: helpDocuments.fileData }).from(helpDocuments).where(eq(helpDocuments.id, id)))[0]?.fileData,
};

const policySource: Source = {
  kind: "policy",
  list: () =>
    db
      .select({ id: companyPolicies.id, filename: companyPolicies.fileName, mimeType: companyPolicies.mimeType })
      .from(companyPolicies)
      .where(and(isNull(companyPolicies.extractedText), ne(companyPolicies.fileData, ""))),
  claim: claimPolicyText,
  fileData: async (id) =>
    (await db.select({ fileData: companyPolicies.fileData }).from(companyPolicies).where(eq(companyPolicies.id, id)))[0]
      ?.fileData,
};

type Extract = (file: DocumentFile) => Promise<ExtractOutcome>;

async function backfill(source: Source, extract: Extract): Promise<BackfillCounts> {
  const counts = empty();
  for (const row of await source.list()) {
    // Claim first, in its own statement: from here on the row reads "tried", whatever happens next.
    if (!(await source.claim(row.id))) continue;
    if (!isExtractable(row.filename, row.mimeType)) {
      counts.unsupported++;
      continue;
    }
    const data = await source.fileData(row.id);
    const outcome: ExtractOutcome = data
      ? await extract({ filename: row.filename, mimeType: row.mimeType, data })
      : { text: null, retry: false };
    await settleText(source.kind, row.id, outcome);
    if (outcome.text !== null) counts.filled++;
    else if (outcome.retry) counts.deferred++;
    else counts.failed++;
  }
  return counts;
}

/**
 * Fills extracted_text where it was never tried; logs one line of counts. Returns null, and claims
 * nothing, when the extractor is missing (a broken build must not mark rows as tried).
 * `extract` is replaceable for tests.
 */
export async function backfillDocumentText(
  log: (line: string) => void = console.log,
  opts: { workerAvailable?: () => boolean; extract?: Extract } = {}
): Promise<{ help: BackfillCounts; policies: BackfillCounts } | null> {
  if (!(opts.workerAvailable ?? documentExtractionAvailable)()) {
    log("Document text backfill skipped: the extractor file was not found");
    return null;
  }
  const extract = opts.extract ?? ((file: DocumentFile) => extractDocumentOutcome(file));
  const help = await backfill(helpSource, extract);
  const policies = await backfill(policySource, extract);
  log(
    `Document text backfill: help documents ${help.filled} filled, ${help.unsupported} unsupported, ${help.failed} unreadable; ` +
      `policies ${policies.filled} filled, ${policies.unsupported} unsupported, ${policies.failed} unreadable`
  );
  const deferred = help.deferred + policies.deferred;
  if (deferred > 0) {
    log(`Document text backfill: ${deferred} row(s) deferred (the extractor was busy); the next start retries them`);
  }
  return { help, policies };
}

/** Runs the backfill and never rejects: a failure is one log line with the error type. */
export async function startDocumentTextBackfill(run: () => Promise<unknown> = () => backfillDocumentText()): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(`Document text backfill failed [${describeError(error)}]`);
  }
}
