import * as React from "react";
import { parseMarkdown, type Inline } from "@crm/shared/records/markdown";

// Renders limited Markdown as React elements (NFR-SEC-004, TC-SEC-010). There is no HTML string
// anywhere in this path: text nodes are escaped by React, and links are limited to
// http(s)/mailto/tel by the parser.

function renderInline(nodes: Inline[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.type) {
      case "text":
        return <React.Fragment key={key}>{node.text}</React.Fragment>;
      case "br":
        return <br key={key} />;
      case "strong":
        return <strong key={key}>{renderInline(node.children, key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case "code":
        return (
          <code key={key} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
            {node.text}
          </code>
        );
      case "link":
        return (
          <a
            key={key}
            href={node.href}
            rel="noopener noreferrer nofollow ugc"
            target={node.href.startsWith("http") ? "_blank" : undefined}
            className="text-primary underline underline-offset-2"
          >
            {renderInline(node.children, key)}
          </a>
        );
    }
  });
}

export function SafeMarkdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className={className}>
      {blocks.map((block, i) => {
        const key = `b-${i}`;
        if (block.type === "p") {
          return (
            <p key={key} className="mb-2 last:mb-0">
              {renderInline(block.children, key)}
            </p>
          );
        }
        const List = block.type;
        return (
          <List
            key={key}
            className={`mb-2 ps-5 last:mb-0 ${block.type === "ul" ? "list-disc" : "list-decimal"}`}
          >
            {block.items.map((item, j) => (
              <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
