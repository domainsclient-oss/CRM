import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOCS } from "@crm/shared/content/docs";
import { PAGES } from "@crm/shared/content/marketing";
import { expectNoA11yViolations } from "../../../../../test/axe";
import { ContactForm } from "./contact-form";
import { DocsSearch } from "./docs-search";
import { FinderForm } from "./finder-form";
import { JsonLdScript, LastUpdated, absolute, pageMetadata, siteOrigin } from "./seo";

const actions = vi.hoisted(() => ({ submitContactAction: vi.fn(), findWorkspaceAction: vi.fn() }));
const vitals = vi.hoisted(() => ({ report: null as null | ((m: unknown) => void) }));
vi.mock("./actions", () => actions);
vi.mock("next/web-vitals", () => ({
  useReportWebVitals: (cb: (m: unknown) => void) => (vitals.report = cb),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("ContactForm (T-08-01)", () => {
  it("submits the demo request including the (empty) honeypot", async () => {
    actions.submitContactAction.mockResolvedValue({ ok: true, data: { received: true } });
    const { container } = render(<ContactForm />);
    await expectNoA11yViolations(container);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Your name"), "Dana");
    await user.type(screen.getByLabelText("Work email"), "dana@agency.test");
    await user.type(screen.getByLabelText("Agency or company"), "Rivera Digital");
    await user.selectOptions(screen.getByLabelText("Team size"), "6-20");
    await user.click(screen.getByRole("button", { name: "Request a demo" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Thanks/);
    expect(actions.submitContactAction).toHaveBeenCalledWith({
      name: "Dana",
      email: "dana@agency.test",
      company: "Rivera Digital",
      teamSize: "6-20",
      message: "",
      website: "",
    });
  });

  it("keeps the honeypot out of the tab order and shows server errors", async () => {
    actions.submitContactAction.mockResolvedValue({
      ok: false,
      error: { code: "RATE_LIMITED", message: "x", requestId: "r" },
    });
    const { container } = render(<ContactForm />);
    expect(container.querySelector("#website")).toHaveAttribute("tabindex", "-1");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Your name"), "Dana");
    await user.type(screen.getByLabelText("Work email"), "dana@agency.test");
    await user.type(screen.getByLabelText("Agency or company"), "Rivera");
    await user.click(screen.getByRole("button", { name: "Request a demo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Too many requests/);
  });
});

describe("FinderForm (FR-PUB-001)", () => {
  it("always answers the same way after sending", async () => {
    actions.findWorkspaceAction.mockResolvedValue({ ok: true, data: { sent: true } });
    render(<FinderForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email address"), "raj@acme.test");
    await user.click(screen.getByRole("button", { name: "Email me my workspaces" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/If that address/);
  });

  it("shows errors", async () => {
    actions.findWorkspaceAction.mockResolvedValue({
      ok: false,
      error: { code: "VALIDATION", message: "x", requestId: "r" },
    });
    render(<FinderForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email address"), "raj@acme.test");
    await user.click(screen.getByRole("button", { name: "Email me my workspaces" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("DocsSearch (FR-PUB-002)", () => {
  it("filters articles by every typed word", async () => {
    const articles = DOCS.map((d) => ({ slug: d.slug, title: d.title, summary: d.summary }));
    render(<DocsSearch articles={articles} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(DOCS.length);
    const user = userEvent.setup();
    const matching = articles.filter((a) =>
      ["import", "csv"].every((w) => `${a.title} ${a.summary}`.toLowerCase().includes(w)),
    );
    expect(matching.length).toBeGreaterThan(0);
    expect(matching.length).toBeLessThan(articles.length);
    await user.type(screen.getByLabelText("Search the help centre"), "Import CSV");
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(matching.length));
    await user.type(screen.getByLabelText("Search the help centre"), " zzzz");
    expect(screen.getByRole("status")).toHaveTextContent("0 articles");
  });
});

describe("SEO helpers (07 §2)", () => {
  it("builds absolute canonicals and index policy from the marketing host", () => {
    vi.stubEnv("APP_MARKETING_HOST", "www.example.com");
    expect(siteOrigin()).toBe("https://www.example.com");
    expect(absolute("/")).toBe("https://www.example.com");
    const meta = pageMetadata(PAGES.features);
    expect(meta.alternates?.canonical).toBe("https://www.example.com/features");
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(pageMetadata(PAGES.findWorkspace, { index: false }).robots).toEqual({
      index: false,
      follow: true,
    });
    vi.stubEnv("APP_MARKETING_HOST", "localhost:3000");
    expect(siteOrigin()).toBe("http://localhost:3000");
  });

  it("renders escaped JSON-LD and the last-updated date", () => {
    const { container } = render(
      <>
        <JsonLdScript data={{ "@context": "https://schema.org", name: "</script><b>" }} />
        <LastUpdated date="2026-10-10" />
      </>,
    );
    const script = container.querySelector('script[type="application/ld+json"]')!;
    expect(script.textContent).not.toContain("</script>");
    expect(JSON.parse(script.textContent!).name).toBe("</script><b>");
    expect(screen.getByText("October 10, 2026")).toHaveAttribute("datetime", "2026-10-10");
  });
});

describe("WebVitals (07 §7)", () => {
  it("beacons a minimal metric when sampled", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.01);
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon });
    const { WebVitals } = await import("./web-vitals");
    render(<WebVitals />);
    act(() => vitals.report!({ name: "LCP", value: 1234.567, rating: "good" }));
    expect(sendBeacon).toHaveBeenCalledWith("/api/vitals", expect.any(Blob));
    const blob = (sendBeacon.mock.calls[0] as unknown as [string, Blob])[1];
    expect(JSON.parse(await blob.text())).toEqual({
      name: "LCP",
      value: 1234.57,
      rating: "good",
      path: "/",
    });
  });
});
