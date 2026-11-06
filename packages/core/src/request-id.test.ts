import { describe, expect, it } from "vitest";
import { newRequestId, requestIdFrom } from "./request-id";

describe("request IDs", () => {
  it("generates unique, URL-safe IDs", () => {
    const ids = new Set(Array.from({ length: 1000 }, newRequestId));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^req_[A-Za-z0-9_-]{12}$/);
  });

  it("accepts well-formed upstream IDs", () => {
    expect(requestIdFrom("abc12345-upstream")).toBe("abc12345-upstream");
  });

  it("replaces malformed or injected values", () => {
    for (const bad of [null, "", "short", 'x"><script>', "a".repeat(200), "line\nbreak123"]) {
      expect(requestIdFrom(bad)).toMatch(/^req_/);
    }
  });
});
