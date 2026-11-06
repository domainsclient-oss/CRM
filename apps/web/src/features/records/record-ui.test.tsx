import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { LIST_ENTITIES, parseListParams } from "@crm/shared/records/list-specs";
import { expectNoA11yViolations } from "../../../../../test/axe";
import type { Formatters } from "./data";
import { Pagination, RecordTable } from "./record-table";
import { TagInput } from "./tag-input";

vi.mock("./data", () => ({}));

const fmt: Formatters = {
  locale: "en-US",
  timeZone: "UTC",
  currency: "USD",
  date: (v) => `date(${String(v)})`,
  dateTime: (v) => `dateTime(${String(v)})`,
  dateOnly: (v) => `dateOnly(${String(v)})`,
  money: (v) => `$${String(v)}`,
};
const lookups = { fmt, members: { u_raj: "Raj" }, stages: { stg_a: "New" } };
const full = {
  id: "r1",
  firstName: "Dana",
  lastName: "Rivera",
  name: "Acme",
  title: "Call",
  email: "dana@acme.test",
  ownerUid: "u_raj",
  assigneeUid: "u_raj",
  createdAt: "2026-10-10T10:00:00.000Z",
  updatedAt: "2026-10-10T10:00:00.000Z",
  lastActivityAt: "2026-10-10T10:00:00.000Z",
  expectedCloseDate: "2026-11-01",
  dueDate: "2026-10-12",
  dueIsDateOnly: true,
  amount: 5000,
  stageId: "stg_a",
  status: "open",
  lifecycleStage: "lead",
  priority: "high",
  source: "web",
  industry: "technology",
  contactCount: 3,
  related: { type: "contact", id: "ct_1", label: "Dana Rivera" },
  done: false,
};
const sparse = {
  id: "r2",
  dueDate: "2026-10-12",
  dueIsDateOnly: false,
  dueAt: "2026-10-12T09:00:00.000Z",
};

describe("RecordTable (T-04-01)", () => {
  it.each(LIST_ENTITIES)("renders %s rows as a table and phone cards", async (entity) => {
    const { container } = render(
      <RecordTable entity={entity} rows={[full, sparse]} lookups={lookups} label="Records" />,
    );
    const links = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === `/${entity}/r1`);
    expect(links.length).toBeGreaterThanOrEqual(2); // card + table row
    expect(
      within(screen.getByRole("list", { name: "Records" })).getAllByRole("listitem"),
    ).toHaveLength(2);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0); // sparse row placeholders
    await expectNoA11yViolations(container);
  });
});

describe("Pagination", () => {
  it("renders previous/next links that carry the cursor trail", () => {
    const params = parseListParams("contacts", {
      cursor: "AAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBB",
      trail: "0",
    });
    render(
      <Pagination
        entity="contacts"
        params={params}
        nextCursor="CCCCCCCCCCCC.DDDDDDDDDDDDDDDDDDDDDDDD"
        basePath="/contacts"
      />,
    );
    expect(screen.getByRole("link", { name: "Next page" }).getAttribute("href")).toContain(
      "CCCCCCCCCCCC.DDDDDDDDDDDDDDDDDDDDDDDD",
    );
    expect(screen.getByRole("link", { name: "Previous page" })).toBeInTheDocument();
  });

  it("renders nothing on a single page", () => {
    const { container } = render(
      <Pagination
        entity="contacts"
        params={parseListParams("contacts", {})}
        nextCursor={null}
        basePath="/contacts"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

function Tags({ initial = [] as string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="tags">Tag entry</label>
      <TagInput id="tags" value={value} onChange={setValue} suggestions={["vip", "partner"]} />
    </>
  );
}

describe("TagInput (FR-REC-002)", () => {
  it("adds tags with Enter, comma and blur, normalized and de-duplicated", async () => {
    render(<Tags />);
    const user = userEvent.setup();
    const input = screen.getByLabelText("Tag entry");
    await user.type(input, "VIP{Enter}");
    await user.type(input, "vip,");
    await user.type(input, "Partner");
    await user.tab();
    const list = screen.getByRole("list", { name: "Tags" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent?.replace("×", "")),
    ).toEqual(["vip", "partner"]);
  });

  it("removes tags with the button or Backspace", async () => {
    render(<Tags initial={["a", "b"]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove tag a" }));
    await user.click(screen.getByLabelText("Tag entry"));
    await user.keyboard("{Backspace}");
    expect(screen.queryByRole("list", { name: "Tags" })).not.toBeInTheDocument();
  });
});
