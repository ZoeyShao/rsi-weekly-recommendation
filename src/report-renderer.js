import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

export function renderReport(markdown) {
  const raw = marked.parse(markdown, { gfm: true, breaks: false });
  return sanitizeHtml(raw, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "p", "blockquote", "ul", "ol", "li",
      "strong", "em", "code", "pre", "hr", "br", "table", "thead", "tbody",
      "tr", "th", "td", "a", "sup", "sub",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      th: ["align"],
      td: ["align"],
      code: ["class"],
    },
    allowedSchemes: ["https", "http"],
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" },
      }),
    },
  });
}
