import { describe, expect, it } from "vitest";
import { BRAND_ASSET_PATH, brandingInput, emailOverrideInput, interpolate } from "./schemas";

describe("branding input", () => {
  it("normalizes colours and treats empty values as inherit", () => {
    expect(
      brandingInput.parse({ appName: " Acme CRM ", primaryColor: "#1f6feb", accentColor: "" }),
    ).toEqual({ appName: "Acme CRM", primaryColor: "#1F6FEB", accentColor: null });
    expect(brandingInput.safeParse({ appName: "x".repeat(41) }).success).toBe(false);
    expect(brandingInput.safeParse({ appName: "<b>Hi</b>" }).success).toBe(false);
    expect(brandingInput.safeParse({ primaryColor: "red" }).success).toBe(false);
    expect(brandingInput.safeParse({ primaryColor: "#123" }).success).toBe(false);
  });

  it("accepts only content-hashed asset paths", () => {
    const hash = "a".repeat(64);
    expect(BRAND_ASSET_PATH.test(`tenant_tnt_acme/${hash}.png`)).toBe(true);
    expect(BRAND_ASSET_PATH.test(`tenant_tnt_acme/${hash}.svg`)).toBe(false);
    expect(BRAND_ASSET_PATH.test(`tenant_tnt_acme/../${hash}.png`)).toBe(false);
    expect(BRAND_ASSET_PATH.test(`other_x/${hash}.png`)).toBe(false);
  });
});

describe("email overrides (FR-BRAND-003, R-13)", () => {
  it("allows plain text with allowlisted variables", () => {
    const ok = emailOverrideInput.parse({
      template: "workspace_invitation",
      subject: "Join {{tenant.name}}",
      intro: "Hi {{user.firstName}}, {{inviter.name}} invited you.",
    });
    expect(ok.subject).toBe("Join {{tenant.name}}");
  });

  it.each([
    ["intro", "Click <a href='x'>here</a>"],
    ["intro", "Visit https://evil.example now"],
    ["intro", "Go to www.evil.test"],
    ["intro", "Pay at evil.com"],
    ["intro", "{{user.password}}"],
    ["subject", "Line one\nline two"],
  ])("rejects %s %s", (field, value) => {
    expect(
      emailOverrideInput.safeParse({
        template: "password_reset",
        subject: null,
        intro: null,
        [field]: value,
      }).success,
    ).toBe(false);
  });

  it("interpolates only allowlisted variables", () => {
    expect(
      interpolate("Hi {{ user.firstName }} at {{tenant.name}} {{x.y}}", {
        "user.firstName": "Mia",
        "tenant.name": "Acme",
      }),
    ).toBe("Hi Mia at Acme {{x.y}}");
  });
});
