import { and, eq, isNull } from "drizzle-orm";
import { companyPolicies, helpDocuments } from "@shared/schema";
import { db } from "../../storage/db";
import { extractDocumentText, type DocumentFile } from "./extractText";

/**
 * extracted_text bookkeeping (R90, review N2). NULL means "never tried"; '' means "tried, nothing
 * extractable", and is also the CLAIM written before any parse starts. So if the process dies
 * while a file is being parsed, the row already says "tried" and the startup backfill never parses
 * it again (no crash loop). Every writer does the same: the REST and MCP uploads store '' with the
 * new file, then fill in the text; the backfill claims a NULL row with '' first, then fills it.
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

/** Extracts the file's text and stores it over the '' mark; returns the text ('' when there is none). */
async function fill(table: Table, id: number, file: DocumentFile): Promise<string> {
  const text = (await extractDocumentText(file)) ?? "";
  if (text) await db.update(table).set({ extractedText: text }).where(eq(table.id, id));
  return text;
}

export const claimHelpDocumentText = (id: number) => claim(helpDocuments, id);
export const claimPolicyText = (id: number) => claim(companyPolicies, id);
export const fillHelpDocumentText = (id: number, file: DocumentFile) => fill(helpDocuments, id, file);
export const fillPolicyText = (id: number, file: DocumentFile) => fill(companyPolicies, id, file);

/** Stores already-extracted text over the '' mark (the backfill, which reads the file itself). */
export async function storeText(table: "help" | "policy", id: number, text: string): Promise<void> {
  if (!text) return;
  const t = table === "help" ? helpDocuments : companyPolicies;
  await db.update(t).set({ extractedText: text }).where(eq(t.id, id));
}
