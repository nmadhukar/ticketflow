import { and, eq, isNull, ne } from "drizzle-orm";
import { companyPolicies, helpDocuments } from "@shared/schema";
import { db } from "../../storage/db";
import { describeError } from "../../http/errors";
import { documentExtractionAvailable, extractDocumentText, isExtractable } from "./extractText";

/**
 * R90 backfill: documents uploaded before extraction existed get their text after the server
 * starts. server/index.ts calls startDocumentTextBackfill once the server is listening, without
 * waiting for it: it never delays or fails boot.
 *
 * extracted_text NULL means "never tried"; '' means "tried, nothing extractable" (an unsupported
 * type, an empty document, or a file that did not parse or hit a limit). Each row is therefore
 * tried ONCE (review I1): a hostile file is not re-parsed at every start. Rows are processed one at
 * a time (a file can be tens of MB), every parse runs in the bounded worker (extractText.ts), and
 * a row is written only while its extracted_text is still NULL, so a concurrent upload is never
 * overwritten. The log carries counts and error types only.
 */

export interface BackfillCounts {
  filled: number;
  unsupported: number;
  failed: number;
}

const empty = (): BackfillCounts => ({ filled: 0, unsupported: 0, failed: 0 });

interface Source {
  list(): Promise<Array<{ id: number; filename: string; mimeType?: string | null }>>;
  fileData(id: number): Promise<string | undefined>;
  mark(id: number, text: string): Promise<unknown>;
}

const helpSource: Source = {
  list: () =>
    db
      .select({ id: helpDocuments.id, filename: helpDocuments.filename })
      .from(helpDocuments)
      .where(and(isNull(helpDocuments.extractedText), ne(helpDocuments.fileData, ""))),
  fileData: async (id) =>
    (await db.select({ fileData: helpDocuments.fileData }).from(helpDocuments).where(eq(helpDocuments.id, id)))[0]?.fileData,
  mark: (id, text) =>
    db.update(helpDocuments).set({ extractedText: text }).where(and(eq(helpDocuments.id, id), isNull(helpDocuments.extractedText))),
};

const policySource: Source = {
  list: () =>
    db
      .select({ id: companyPolicies.id, filename: companyPolicies.fileName, mimeType: companyPolicies.mimeType })
      .from(companyPolicies)
      .where(and(isNull(companyPolicies.extractedText), ne(companyPolicies.fileData, ""))),
  fileData: async (id) =>
    (await db.select({ fileData: companyPolicies.fileData }).from(companyPolicies).where(eq(companyPolicies.id, id)))[0]
      ?.fileData,
  mark: (id, text) =>
    db
      .update(companyPolicies)
      .set({ extractedText: text })
      .where(and(eq(companyPolicies.id, id), isNull(companyPolicies.extractedText))),
};

async function backfill(source: Source): Promise<BackfillCounts> {
  const counts = empty();
  for (const row of await source.list()) {
    if (!isExtractable(row.filename, row.mimeType)) {
      await source.mark(row.id, "");
      counts.unsupported++;
      continue;
    }
    const data = await source.fileData(row.id);
    const text = data ? await extractDocumentText({ filename: row.filename, mimeType: row.mimeType, data }) : null;
    await source.mark(row.id, text ?? "");
    if (text === null) counts.failed++;
    else counts.filled++;
  }
  return counts;
}

/**
 * Fills extracted_text where it was never tried; logs one line of counts. Returns null, and marks
 * nothing, when the extraction worker is missing (a broken build must not mark rows as tried).
 */
export async function backfillDocumentText(
  log: (line: string) => void = console.log,
  opts: { workerAvailable?: () => boolean } = {}
): Promise<{ help: BackfillCounts; policies: BackfillCounts } | null> {
  if (!(opts.workerAvailable ?? documentExtractionAvailable)()) {
    log("Document text backfill skipped: the extraction worker file was not found");
    return null;
  }
  const help = await backfill(helpSource);
  const policies = await backfill(policySource);
  log(
    `Document text backfill: help documents ${help.filled} filled, ${help.unsupported} unsupported, ${help.failed} unreadable; ` +
      `policies ${policies.filled} filled, ${policies.unsupported} unsupported, ${policies.failed} unreadable`
  );
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
