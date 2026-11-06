import { describe, expect, it } from "vitest";
import { MemoryRateLimiter } from "./rate-limit";

const policy = { name: "t", limit: 3, windowSeconds: 60 };

describe("MemoryRateLimiter (TC-SEC-007)", () => {
  it("allows up to the limit, then blocks with Retry-After", async () => {
    let now = 1_000_000;
    const rl = new MemoryRateLimiter(() => now);
    for (let i = 0; i < 3; i++) expect((await rl.hit("k", policy)).allowed).toBe(true);
    const blocked = await rl.hit("k", policy);
    expect(blocked).toMatchObject({ allowed: false, remaining: 0 });
    expect(blocked.retryAfterSeconds).toBe(60);
    now += 30_000;
    expect((await rl.hit("k", policy)).retryAfterSeconds).toBe(30);
  });

  it("frees capacity as the window slides", async () => {
    let now = 0;
    const rl = new MemoryRateLimiter(() => now);
    for (let i = 0; i < 3; i++) await rl.hit("k", policy);
    now += 60_001;
    expect((await rl.hit("k", policy)).allowed).toBe(true);
  });

  it("isolates keys and policies", async () => {
    const rl = new MemoryRateLimiter(() => 0);
    for (let i = 0; i < 3; i++) await rl.hit("a", policy);
    expect((await rl.hit("b", policy)).allowed).toBe(true);
    expect((await rl.hit("a", { ...policy, name: "other" })).allowed).toBe(true);
  });
});
