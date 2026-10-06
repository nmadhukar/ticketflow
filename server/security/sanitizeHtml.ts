import sanitizeHtml from "sanitize-html";

/**
 * Allow-list for fields that are rendered as HTML (user guide content). Anything
 * not listed is dropped; `<script>`, `<style>` and similar keep none of their
 * body. Used on write AND on read, so rows stored before this existed are
 * cleaned on their way out.
 */
const RICH_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr", "div", "span",
    "b", "strong", "i", "em", "u", "s", "sub", "sup", "mark", "small",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "blockquote", "pre", "code",
    "a", "img",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
  },
};

/** Sanitise HTML meant to be rendered as HTML. Non-strings become "". */
export function sanitizeRichHtml(html: unknown): string {
  if (typeof html !== "string") return "";
  return sanitizeHtml(html, RICH_OPTIONS);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/**
 * The readable text of an HTML fragment (guide content read by an agent, task MCP4): every tag
 * dropped (`<script>`/`<style>` with their bodies), block ends kept as line breaks, the common
 * entities decoded, blank runs collapsed. With `fragment` (a search snippet cut out of the
 * middle), a partial tag at either end is dropped too. Non-strings become "".
 */
export function htmlToPlainText(html: unknown, fragment = false): string {
  if (typeof html !== "string") return "";
  const cut = fragment ? html.replace(/^[^<]*?>/, " ").replace(/<[^>]*$/, " ") : html;
  const withBreaks = cut.replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/blockquote|\/pre)\b[^>]*>/gi, "$&\n");
  const text = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {}, disallowedTagsMode: "discard" });
  return text
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n")
    .trim();
}
