// Limited Markdown for activity bodies (FR-ACT-001, NFR-SEC-004, TC-SEC-010). Parses to a
// small AST that the UI renders as React elements — HTML in the source is never interpreted,
// only shown as text. Supported: paragraphs, line breaks, - / 1. lists, **bold**, *italic*,
// `code`, and [links](https://…) limited to http(s), mailto, and tel.

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "br" };

export type Block = { type: "p"; children: Inline[] } | { type: "ul" | "ol"; items: Inline[][] };

const SAFE_HREF = /^(https?:\/\/[^\s]+|mailto:[^\s]+|tel:[+\d\s()-]+)$/i;

export function safeHref(href: string): string | null {
  const value = href.trim();
  return SAFE_HREF.test(value) ? value : null;
}

const INLINE = /(\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let rest = source;
  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (!match) {
      out.push({ type: "text", text: rest });
      break;
    }
    if (match.index > 0) out.push({ type: "text", text: rest.slice(0, match.index) });
    const [whole, , strong, em, code, linkText, linkHref] = match;
    if (strong !== undefined) out.push({ type: "strong", children: parseInline(strong) });
    else if (em !== undefined) out.push({ type: "em", children: parseInline(em) });
    else if (code !== undefined) out.push({ type: "code", text: code });
    else if (linkText !== undefined && linkHref !== undefined) {
      const href = safeHref(linkHref);
      out.push(
        href
          ? { type: "link", href, children: parseInline(linkText) }
          : { type: "text", text: whole },
      );
    }
    rest = rest.slice(match.index + whole.length);
  }
  return out;
}

function withBreaks(lines: string[]): Inline[] {
  return lines.flatMap((line, i) => [
    ...(i > 0 ? [{ type: "br" } as const] : []),
    ...parseInline(line),
  ]);
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const chunks = source.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const chunk of chunks) {
    const lines = chunk.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      blocks.push({
        type: "ul",
        items: lines.map((l) => parseInline(l.replace(/^\s*[-*]\s+/, ""))),
      });
    } else if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      blocks.push({
        type: "ol",
        items: lines.map((l) => parseInline(l.replace(/^\s*\d+[.)]\s+/, ""))),
      });
    } else {
      blocks.push({ type: "p", children: withBreaks(lines) });
    }
  }
  return blocks;
}
