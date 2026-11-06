import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SafeMarkdown } from "./safe-markdown";

// TC-SEC-010: activity bodies never execute HTML or script.
describe("SafeMarkdown", () => {
  it.each([
    "<script>window.__xss = 1</script>",
    '<img src=x onerror="window.__xss=1">',
    "[click](javascript:window.__xss=1)",
    '<a href="javascript:alert(1)">x</a>',
    "<svg onload=alert(1)>",
    "[x](data:text/html;base64,PHNjcmlwdD4=)",
  ])("renders %s as inert text", (payload) => {
    const { container } = render(<SafeMarkdown source={payload} />);
    expect(container.querySelector("script, img, svg, iframe")).toBeNull();
    for (const a of container.querySelectorAll("a")) {
      expect(a.getAttribute("href")).toMatch(/^(https?:|mailto:|tel:)/);
    }
    expect(container.textContent).toContain(payload.slice(0, 5));
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it("renders formatting and safe links", () => {
    const { container } = render(
      <SafeMarkdown source={"**Bold** and [site](https://acme.test)\n\n- one\n- two"} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("Bold");
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("https://acme.test");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });
});
