import { describe, expect, it } from "vitest";
import { parseListParams, listQuery } from "./list-specs";
import { parseMarkdown, safeHref } from "./markdown";
import { formatMoney, minorToDecimalString, parseMoney } from "./money";
import {
  buildSearchTokens,
  foldText,
  normalizeDomain,
  normalizeEmail,
  normalizeTag,
  tagId,
} from "./normalize";
import {
  activityInput,
  companyInput,
  contactInput,
  dealInput,
  leadInput,
  taskInput,
} from "./schemas";
import { addDays, dayKey, isValidTimeZone, taskGroup, timeKey, zonedToUtc } from "./time";

describe("normalizers", () => {
  it("folds diacritics and case", () => {
    expect(foldText("  Ünïcödé Çafé ")).toBe("unicode cafe");
  });

  it("normalizes emails", () => {
    expect(normalizeEmail("  Raj.Patel@Example.COM ")).toBe("raj.patel@example.com");
  });

  it.each([
    ["https://www.Acme.test/path?q=1", "acme.test"],
    ["http://acme.test:8080", "acme.test"],
    ["WWW.acme.co.uk", "acme.co.uk"],
    ["acme.test.", "acme.test"],
    ["not a domain", null],
    ["localhost", null],
    ["", null],
  ])("normalizeDomain(%s) = %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it("normalizes tags case-insensitively and gives stable ids", () => {
    expect(normalizeTag("  VIP   Client ")).toBe("vip client");
    expect(tagId("vip client")).toBe(tagId(normalizeTag("VIP  client")));
    expect(tagId("vip client")).toMatch(/^[a-z0-9-]+$/);
    expect(tagId("ünï")).not.toBe(tagId("uni"));
  });

  it("builds capped prefix search tokens", () => {
    const tokens = buildSearchTokens(["Raj Patel", "raj@acme.test", null]);
    expect(tokens).toEqual(expect.arrayContaining(["ra", "raj", "pa", "patel", "ac", "acme"]));
    expect(tokens).not.toContain("r");
    const many = buildSearchTokens([
      "a".repeat(40) + " " + "abcdefghijklmnop qrstuvwxyz".repeat(5),
    ]);
    expect(many.length).toBeLessThanOrEqual(60);
    expect(many.every((t) => t.length <= 15)).toBe(true);
  });
});

describe("money (no floating point)", () => {
  it.each([
    ["1250", "USD", 125000],
    ["1250.5", "USD", 125050],
    ["1250,55", "EUR", 125055],
    ["0.1", "USD", 10],
    ["1000", "JPY", 1000],
    ["1.234", "KWD", 1234],
    ["0.29", "USD", 29],
  ])("parseMoney(%s, %s) = %d", (input, currency, minor) => {
    expect(parseMoney(input, currency)).toBe(minor);
  });

  it.each([
    ["1.5", "JPY"],
    ["1.001", "USD"],
    ["-1", "USD"],
    ["1e5", "USD"],
    ["abc", "USD"],
    ["100000000000000", "USD"],
  ])("rejects %s %s", (input, currency) => {
    expect(parseMoney(input, currency)).toBeNull();
  });

  it("formats from minor units via decimal strings", () => {
    expect(minorToDecimalString(5, "USD")).toBe("0.05");
    expect(minorToDecimalString(123456, "USD")).toBe("1234.56");
    expect(minorToDecimalString(1000, "JPY")).toBe("1000");
    expect(formatMoney(123456, "USD", "en-US")).toBe("$1,234.56");
    expect(formatMoney(9_999_999_999_999, "USD", "en-US")).toBe("$99,999,999,999.99");
  });
});

describe("time zones", () => {
  it("validates IANA zones", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });

  it("converts wall-clock time to UTC, including DST", () => {
    expect(zonedToUtc("2026-01-15", "09:00", "Asia/Kolkata").toISOString()).toBe(
      "2026-01-15T03:30:00.000Z",
    );
    expect(zonedToUtc("2026-07-01", "09:00", "America/New_York").toISOString()).toBe(
      "2026-07-01T13:00:00.000Z",
    );
    expect(zonedToUtc("2026-12-01", "09:00", "America/New_York").toISOString()).toBe(
      "2026-12-01T14:00:00.000Z",
    );
  });

  it("computes day keys in a zone", () => {
    const instant = new Date("2026-03-01T22:30:00Z");
    expect(dayKey(instant, "UTC")).toBe("2026-03-01");
    expect(dayKey(instant, "Asia/Kolkata")).toBe("2026-03-02");
    expect(timeKey(instant, "Asia/Kolkata")).toBe("04:00");
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
  });

  it("groups tasks for My tasks in the viewer's zone (FR-TASK-002)", () => {
    const now = new Date("2026-03-10T12:00:00Z");
    const tz = "UTC";
    const at = (iso: string, dateOnly = false) => ({
      dueAt: new Date(iso),
      dueIsDateOnly: dateOnly,
      dueDate: dateOnly ? iso.slice(0, 10) : null,
    });
    expect(taskGroup({ dueAt: null, dueIsDateOnly: false }, now, tz)).toBe("none");
    expect(taskGroup(at("2026-03-09T09:00:00Z", true), now, tz)).toBe("overdue");
    expect(taskGroup(at("2026-03-10T09:00:00Z", true), now, tz)).toBe("today");
    expect(taskGroup(at("2026-03-10T11:00:00Z"), now, tz)).toBe("overdue");
    expect(taskGroup(at("2026-03-10T15:00:00Z"), now, tz)).toBe("today");
    expect(taskGroup(at("2026-03-17T09:00:00Z", true), now, tz)).toBe("next7");
    expect(taskGroup(at("2026-03-18T09:00:00Z", true), now, tz)).toBe("later");
  });
});

describe("limited Markdown (TC-SEC-010)", () => {
  it("parses paragraphs, emphasis, code, lists, and safe links", () => {
    expect(parseMarkdown("Hello **bold** and *it* `x`\nline two\n\n- a\n- b\n\n1. one")).toEqual([
      {
        type: "p",
        children: [
          { type: "text", text: "Hello " },
          { type: "strong", children: [{ type: "text", text: "bold" }] },
          { type: "text", text: " and " },
          { type: "em", children: [{ type: "text", text: "it" }] },
          { type: "text", text: " " },
          { type: "code", text: "x" },
          { type: "br" },
          { type: "text", text: "line two" },
        ],
      },
      { type: "ul", items: [[{ type: "text", text: "a" }], [{ type: "text", text: "b" }]] },
      { type: "ol", items: [[{ type: "text", text: "one" }]] },
    ]);
  });

  it("keeps HTML as text and drops unsafe link schemes", () => {
    const blocks = parseMarkdown(
      "<img src=x onerror=alert(1)> [click](javascript:alert(1)) [ok](https://acme.test)",
    );
    const children = blocks.flatMap((b) => (b.type === "p" ? b.children : []));
    // Only the https link becomes a link; everything else stays literal text.
    expect(children.filter((c) => c.type === "link")).toEqual([
      { type: "link", href: "https://acme.test", children: [{ type: "text", text: "ok" }] },
    ]);
    expect(
      children
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join(""),
    ).toBe("<img src=x onerror=alert(1)> [click](javascript:alert(1)) ");
    expect(safeHref("data:text/html,<script>")).toBeNull();
    expect(safeHref("mailto:raj@acme.test")).toBe("mailto:raj@acme.test");
    expect(safeHref("tel:+1 (555) 010-0000")).toBe("tel:+1 (555) 010-0000");
  });
});

describe("record schemas", () => {
  it("turns empty optional fields into null and validates required ones", () => {
    const parsed = contactInput.parse({
      firstName: "  Raj ",
      lastName: "",
      email: " RAJ@Acme.TEST ",
      companyId: "",
    });
    expect(parsed).toMatchObject({ firstName: "Raj", lastName: null, email: "raj@acme.test" });
    expect(parsed.companyId).toBeNull();
    expect(parsed.lifecycleStage).toBe("lead");
    expect(contactInput.safeParse({ firstName: "" }).success).toBe(false);
    expect(contactInput.safeParse({ firstName: "x", email: "nope" }).success).toBe(false);
  });

  it("validates companies (domain, url, country, tags)", () => {
    const ok = companyInput.parse({
      name: "Acme",
      domain: "https://www.acme.test",
      website: "https://acme.test",
      address: { line1: "", line2: "", city: "Pune", region: "", postalCode: "", country: "in" },
      tags: ["VIP", "vip ", "Key Account"],
    });
    expect(ok.tags).toEqual(["vip", "key account"]);
    expect(ok.address.country).toBe("IN");
    expect(companyInput.safeParse({ name: "A", website: "javascript:alert(1)" }).success).toBe(
      false,
    );
    expect(companyInput.safeParse({ name: "A", tags: ["<script>"] }).success).toBe(false);
    expect(
      companyInput.safeParse({ name: "A", tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })
        .success,
    ).toBe(false);
  });

  it("validates leads, deals, tasks, and activities", () => {
    expect(leadInput.safeParse({ firstName: "L", status: "converted" }).success).toBe(false);
    expect(leadInput.parse({ firstName: "L", estimatedValue: "1000.50" }).estimatedValue).toBe(
      "1000.50",
    );
    expect(dealInput.safeParse({ name: "D", stageId: "s1", amount: "-5" }).success).toBe(false);
    expect(dealInput.parse({ name: "D", stageId: "s1", probability: "40" }).probability).toBe(40);
    expect(taskInput.safeParse({ title: "T", dueTime: "10:00" }).success).toBe(false);
    expect(
      taskInput.parse({ title: "T", related: { type: "contact", id: "" } }).related,
    ).toBeNull();
    expect(
      activityInput.safeParse({
        type: "call",
        subject: "S",
        occurredDate: "2026-02-30",
        occurredTime: "10:00",
        related: [{ type: "contact", id: "c1" }],
      }).success,
    ).toBe(false);
  });
});

describe("list params", () => {
  it("falls back to defaults for anything unknown", () => {
    const p = parseListParams("contacts", {
      sort: "ownerUid",
      filter: "email",
      value: "x",
      cursor: "../../etc",
      size: "100000",
    });
    expect(p.sort.id).toBe("updated");
    expect(p.filter).toBeNull();
    expect(p.cursor).toBeNull();
    expect(p.pageSize).toBe(25);
  });

  it("accepts allowlisted filters with validated values", () => {
    expect(parseListParams("contacts", { filter: "stage", value: "customer" }).filter?.value).toBe(
      "customer",
    );
    expect(parseListParams("contacts", { filter: "stage", value: "boss" }).filter).toBeNull();
    expect(parseListParams("deals", { filter: "tag", value: " VIP " }).filter?.value).toBe("vip");
    expect(listQuery("contacts", { sort: "name", filter: "stage", value: "customer" })).toBe(
      "?sort=name&filter=stage&value=customer",
    );
  });
});
