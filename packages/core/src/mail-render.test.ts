import { describe, expect, it } from "vitest";
import { escapeHtml, fromHeader, renderMail } from "./mail-render";

const brand = {
  appName: "Acme <CRM>",
  primary: "#1F6FEB",
  primaryFg: "#FFFFFF",
  logoUrl: "https://crm.acme.test/api/brand/tenant_t/abc.png",
  showPoweredBy: true,
};

// TC-BRAND-003: branded, escaped, no tenant-controlled HTML or links.
describe("renderMail", () => {
  it("brands and escapes every value", () => {
    const mail = renderMail(
      "workspace_invitation",
      { name: "<script>x</script>", link: "https://crm.acme.test/invite/tok" },
      brand,
    );
    expect(mail.subject).toBe("You're invited to <script>x</script>"); // subject is plain text
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(mail.html).toContain('alt="Acme &lt;CRM&gt;"');
    expect(mail.html).toContain("background:#1F6FEB;color:#FFFFFF");
    expect(mail.html).toContain('href="https://crm.acme.test/invite/tok"');
    expect(mail.text).toContain("Accept invitation: https://crm.acme.test/invite/tok");
    expect(mail.html).toContain("Powered by CRM");
  });

  it("applies overrides with allowlisted variables only and keeps them inert", () => {
    const mail = renderMail(
      "workspace_invitation",
      { name: "Acme", link: "https://crm.acme.test/invite/tok", inviter: "Olivia" },
      { ...brand, showPoweredBy: false },
      { subject: "Join {{tenant.name}}\r\nBcc: evil@x", intro: "{{inviter.name}} says <b>hi</b>" },
    );
    expect(mail.subject).toBe("Join Acme Bcc: evil@x");
    expect(mail.html).toContain("Olivia says &lt;b&gt;hi&lt;/b&gt;");
    expect(mail.html).not.toContain("Powered by");
  });

  it("drops non-http links and invalid colours", () => {
    const mail = renderMail(
      "password_reset",
      { link: "javascript:alert(1)" },
      { ...brand, primary: "red;}", logoUrl: "javascript:x" },
    );
    expect(mail.html).not.toContain("javascript:");
    expect(mail.html).not.toContain("red;}");
    expect(mail.html).toContain("<strong");
  });

  it("renders a demo-request confirmation and escapes the submitter's name", () => {
    const mail = renderMail("demo_request_confirmation", { name: "<script>Dana</script>" }, brand);
    expect(mail.subject).toBe("We received your demo request");
    expect(mail.html).toContain("Hi &lt;script&gt;Dana&lt;/script&gt;");
    expect(mail.html).not.toContain("<script>");
    expect(mail.text).toContain("You received this because you requested a demo.");
  });

  it("sanitises header values", () => {
    expect(fromHeader('Evil"\r\nBcc: x', "no-reply@mail.example.com")).toBe(
      '"Evil Bcc: x" <no-reply@mail.example.com>',
    );
    expect(escapeHtml(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;");
  });
});
