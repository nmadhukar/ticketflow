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
