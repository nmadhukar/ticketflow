import { and, eq, isNull } from "drizzle-orm";
import { companyPolicies, helpDocuments } from "@shared/schema";
import { db } from "../../storage/db";
import { extractDocumentOutcome, type DocumentFile, type ExtractOptions, type ExtractOutcome } from "./extractText";

/**
 * extracted_text bookkeeping (R90, reviews N2 and N9). NULL means "never tried"; '' means "tried,
 * nothing extractable", and is also the CLAIM written before any parse starts. So if the process
 * dies while a file is being parsed, the row already says "tried" and the startup backfill never
 * parses it again (no crash loop). Every writer does the same: the REST and MCP uploads store ''
 * with the new file, then fill in the text; the backfill claims a NULL row with '' first, then
 * fills it. When no parse began at all (the extractor was busy, or the call ran out of time in
 * its queue), the claim is handed back: the row returns to NULL, so it is retried later.
 */

type Table = typeof helpDocuments | typeof companyPolicies;

/** Claims a never-tried row: '' where extracted_text is still NULL. True when this caller got it. */
async function claim(table: Table, id: number): Promise<boolean> {
  const rows = await db
    .update(table)
    .set({ extractedText: "" })
    .where(and(eq(table.id, id), isNull(table.extractedText)))
    .returning({ id: table.id });
  return rows.length > 0;
}

/** Stores an outcome over the '' claim: the text, or NULL again when no parse began (retry). */
async function settle(table: Table, id: number, outcome: ExtractOutcome): Promise<void> {
  if (outcome.text) {
    await db.update(table).set({ extractedText: outcome.text }).where(eq(table.id, id));
  } else if (outcome.retry) {
    // Only our own claim is handed back: a row that meanwhile got text is left alone.
    await db.update(table).set({ extractedText: null }).where(and(eq(table.id, id), eq(table.extractedText, "")));
  }
}

/**
 * Extracts the file's text and stores it over the '' mark. Returns what the row now holds: the
 * text, '' (tried, none), or null (no parse began; it will be retried).
 */
async function fill(table: Table, id: number, file: DocumentFile, opts?: ExtractOptions): Promise<string | null> {
  const outcome = await extractDocumentOutcome(file, opts);
  await settle(table, id, outcome);
  return outcome.text ?? (outcome.retry ? null : "");
}

export const claimHelpDocumentText = (id: number) => claim(helpDocuments, id);
export const claimPolicyText = (id: number) => claim(companyPolicies, id);
export const fillHelpDocumentText = (id: number, file: DocumentFile, opts?: ExtractOptions) => fill(helpDocuments, id, file, opts);
export const fillPolicyText = (id: number, file: DocumentFile, opts?: ExtractOptions) => fill(companyPolicies, id, file, opts);

/** Stores an outcome the caller extracted itself (the backfill, which reads the file itself). */
export async function settleText(table: "help" | "policy", id: number, outcome: ExtractOutcome): Promise<void> {
  await settle(table === "help" ? helpDocuments : companyPolicies, id, outcome);
}
