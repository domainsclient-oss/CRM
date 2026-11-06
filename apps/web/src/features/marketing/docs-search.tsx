"use client";

import Link from "next/link";
import { useState } from "react";

// Client-side docs search over titles and summaries (FR-PUB-002): all articles are rendered in the
// HTML (crawlable); typing filters the list.
export function DocsSearch({
  articles,
}: {
  articles: Array<{ slug: string; title: string; summary: string }>;
}) {
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = articles.filter((a) =>
    words.every((w) => `${a.title} ${a.summary}`.toLowerCase().includes(w)),
  );
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Search the help centre
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-10 rounded-lg border bg-transparent px-3 text-base font-normal"
        />
      </label>
      <p role="status" className="text-sm text-muted-foreground">
        {shown.length} {shown.length === 1 ? "article" : "articles"}
      </p>
      <ul className="flex flex-col gap-4">
        {shown.map((a) => (
          <li key={a.slug} className="rounded-xl border p-4">
            <h2 className="text-lg font-semibold">
              <Link href={`/docs/${a.slug}`} className="hover:underline">
                {a.title}
              </Link>
            </h2>
            <p className="text-muted-foreground">{a.summary}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
