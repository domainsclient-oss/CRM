import { describe, expect, it } from "vitest";
import { isPlaceholder, loadInstances, parseDeployEnv, publicConfigFor } from "./instances";

describe("instance registry", () => {
  it("every registry file validates and names match", () => {
    const instances = loadInstances();
    expect(instances.length).toBeGreaterThan(0);
  });

  it("instance names are unique", () => {
    const names = loadInstances().map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("derives runtime config without secrets", () => {
    const [instance] = loadInstances();
    const config = publicConfigFor(instance!, "staging");
    expect(config.APP_ENV).toBe("staging");
    expect(Object.keys(config).some((k) => /SECRET|KEY|TOKEN/.test(k))).toBe(false);
  });

  it("detects placeholders and rejects unknown environments", () => {
    expect(isPlaceholder("<dev-project-id>")).toBe(true);
    expect(isPlaceholder("crm-dev-123")).toBe(false);
    expect(() => parseDeployEnv("prod")).toThrow();
  });
});
