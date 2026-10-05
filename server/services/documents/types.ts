/** Document vocabulary shared by the MCP tools and the document services (task MCP4); no database imports. */

export const DOCUMENT_TYPES = ["help", "policy", "guideline", "knowledge"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** search_documents: the most results one call returns. */
export const SEARCH_MAX_LIMIT = 50;

/** user_guides.type, as the admin guide form offers them. */
export const GUIDE_TYPES = ["html", "scribehow", "video"] as const;
