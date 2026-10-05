import { and, eq, isNull, ne } from "drizzle-orm";
import { companyPolicies, helpDocuments } from "@shared/schema";
import { db } from "../../storage/db";
import { extractDocumentText, isExtractable } from "./extractText";

/**
 * R90 backfill: documents uploaded before extraction existed (extracted_text IS NULL, a file
 * present) get their text at startup. Best effort: server/seed/runSeeders.ts starts it without
 * waiting, so it never blocks or fails boot. Each row is read and parsed one at a time (a file
 * can be tens of MB), and written only while its extracted_text is still NULL, so a concurrent
 * upload is never overwritten. Unsupported types are not read at all. A file that does not parse
 * stays NULL (and is tried again at the next start); the log carries counts and error types only.
 */

export interface BackfillCounts {
  filled: number;
  unsupported: number;
  failed: number;
}

const empty = (): BackfillCounts => ({ filled: 0, unsupported: 0, failed: 0 });

async function backfillHelp(): Promise<BackfillCounts> {
  const counts = empty();
  const rows = await db
    .select({ id: helpDocuments.id, filename: helpDocuments.filename })
    .from(helpDocuments)
    .where(and(isNull(helpDocuments.extractedText), ne(helpDocuments.fileData, "")));
  for (const row of rows) {
    if (!isExtractable(row.filename)) {
      counts.unsupported++;
      continue;
    }
    const [file] = await db
      .select({ fileData: helpDocuments.fileData })
      .from(helpDocuments)
      .where(eq(helpDocuments.id, row.id));
    const text = file ? await extractDocumentText({ filename: row.filename, data: file.fileData }) : null;
    if (text === null) {
      counts.failed++;
      continue;
    }
    await db
      .update(helpDocuments)
      .set({ extractedText: text })
      .where(and(eq(helpDocuments.id, row.id), isNull(helpDocuments.extractedText)));
    counts.filled++;
  }
  return counts;
}

async function backfillPolicies(): Promise<BackfillCounts> {
  const counts = empty();
  const rows = await db
    .select({ id: companyPolicies.id, fileName: companyPolicies.fileName, mimeType: companyPolicies.mimeType })
    .from(companyPolicies)
    .where(and(isNull(companyPolicies.extractedText), ne(companyPolicies.fileData, "")));
  for (const row of rows) {
    if (!isExtractable(row.fileName, row.mimeType)) {
      counts.unsupported++;
      continue;
    }
    const [file] = await db
      .select({ fileData: companyPolicies.fileData })
      .from(companyPolicies)
      .where(eq(companyPolicies.id, row.id));
    const text = file
      ? await extractDocumentText({ filename: row.fileName, mimeType: row.mimeType, data: file.fileData })
      : null;
    if (text === null) {
      counts.failed++;
      continue;
    }
    await db
      .update(companyPolicies)
      .set({ extractedText: text })
      .where(and(eq(companyPolicies.id, row.id), isNull(companyPolicies.extractedText)));
    counts.filled++;
  }
  return counts;
}

/** Fills extracted_text where it is missing; logs one line of counts. */
export async function backfillDocumentText(log: (line: string) => void = console.log) {
  const help = await backfillHelp();
  const policies = await backfillPolicies();
  log(
    `Document text backfill: help documents ${help.filled} filled, ${help.unsupported} unsupported, ${help.failed} unreadable; ` +
      `policies ${policies.filled} filled, ${policies.unsupported} unsupported, ${policies.failed} unreadable`
  );
  return { help, policies };
}
