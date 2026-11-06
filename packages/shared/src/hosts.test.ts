import { describe, expect, it } from "vitest";
import { classifyHost, isSameOrigin, normalizeHost } from "./hosts";

const config = {
  marketingHost: "www.example.com",
  consoleHost: "console.example.com",
  partnersHost: "partners.example.com",
};

describe("normalizeHost", () => {
  it.each([
    ["Acme.App.Example.com", "acme.app.example.com"],
    ["crm.acme.test.", "crm.acme.test"],
    ["acme.app.localhost:3000", "acme.app.localhost:3000"],
    ["  www.example.com ", "www.example.com"],
  ])("%s → %s", (raw, expected) => expect(normalizeHost(raw)).toBe(expected));

  it.each([
    null,
    "",
    "evil.com/path",
    "a b.com",
    "x\r\ninjected",
    "-bad.com",
    "under_score.com",
    "a".repeat(300),
  ])("rejects %s", (raw) => expect(normalizeHost(raw)).toBeNull());
});

describe("classifyHost", () => {
  it("classifies configured hosts exactly", () => {
    expect(classifyHost("www.example.com", config)).toBe("marketing");
    expect(classifyHost("console.example.com", config)).toBe("console");
    expect(classifyHost("partners.example.com", config)).toBe("partners");
  });
  it("treats everything else as a candidate workspace host", () => {
    expect(classifyHost("crm.acme.test", config)).toBe("workspace");
    expect(classifyHost("console.example.com.evil.test", config)).toBe("workspace");
  });
});

describe("isSameOrigin", () => {
  it("accepts matching origins and rejects others", () => {
    expect(isSameOrigin("https://crm.acme.test", "crm.acme.test")).toBe(true);
    expect(isSameOrigin("http://acme.app.localhost:3000", "acme.app.localhost:3000")).toBe(true);
    expect(isSameOrigin("https://evil.test", "crm.acme.test")).toBe(false);
    expect(isSameOrigin(null, "crm.acme.test")).toBe(false);
    expect(isSameOrigin("null", "crm.acme.test")).toBe(false);
  });
});
