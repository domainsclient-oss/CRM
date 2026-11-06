import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RedisRestRateLimiter } from "./rate-limit-redis";
import { enforceRateLimit, setRateLimiter, type RateLimiter } from "./rate-limit";

// Upstash REST semantics for the commands the limiter uses, over in-memory sorted sets.
function fakeUpstash() {
  const sets = new Map<string, Map<string, number>>();
  const calls: Array<{ path: string; auth: string | null; body: string[][] }> = [];
  const run = (cmd: string[]): unknown => {
    const [op, key] = [cmd[0]!, cmd[1]!];
    const set = sets.get(key) ?? new Map<string, number>();
    sets.set(key, set);
    switch (op) {
      case "ZREMRANGEBYSCORE": {
        let n = 0;
        for (const [m, s] of set)
          if (s >= Number(cmd[2]) && s <= Number(cmd[3])) (set.delete(m), n++);
        return n;
      }
      case "ZADD":
        set.set(cmd[3]!, Number(cmd[2]));
        return 1;
      case "ZCARD":
        return set.size;
      case "PEXPIRE":
        return 1;
      case "ZRANGE": {
        const first = [...set].sort((a, b) => a[1] - b[1])[0];
        return first ? [first[0], String(first[1])] : [];
      }
      case "ZREM":
        return set.delete(cmd[2]!) ? 1 : 0;
      default:
        return { error: `unknown ${op}` };
    }
  };
  const fetcher = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as string[][];
    calls.push({
      path: new URL(url).pathname,
      auth: new Headers(init.headers).get("authorization"),
      body,
    });
    return new Response(JSON.stringify(body.map((c) => ({ result: run(c) }))));
  }) as unknown as typeof fetch;
  return { fetcher, calls, sets };
}

const policy = { name: "t", limit: 3, windowSeconds: 60 };

describe("RedisRestRateLimiter (ADR-013, TC-SEC-007)", () => {
  it("allows up to the limit, then blocks with Retry-After, atomically via MULTI/EXEC", async () => {
    const { fetcher, calls } = fakeUpstash();
    let now = 1_000_000;
    const rl = new RedisRestRateLimiter(
      { url: "https://r.test/", token: "tok", fetch: fetcher },
      () => now,
    );
    for (let i = 0; i < 3; i++) expect((await rl.hit("k", policy)).allowed).toBe(true);
    const blocked = await rl.hit("k", policy);
    expect(blocked).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
    now += 30_000;
    expect((await rl.hit("k", policy)).retryAfterSeconds).toBe(30);
    expect(calls[0]).toMatchObject({ path: "/multi-exec", auth: "Bearer tok" });
  });

  it("does not count refused hits, and frees capacity as the window slides", async () => {
    const { fetcher } = fakeUpstash();
    let now = 0;
    const rl = new RedisRestRateLimiter(
      { url: "https://r.test", token: "t", fetch: fetcher },
      () => now,
    );
    for (let i = 0; i < 10; i++) await rl.hit("k", policy);
    now += 60_001;
    expect((await rl.hit("k", policy)).allowed).toBe(true);
  });

  it("hashes keys so IPs and emails never reach the store; isolates policies", async () => {
    const { fetcher, sets } = fakeUpstash();
    const rl = new RedisRestRateLimiter(
      { url: "https://r.test", token: "t", fetch: fetcher },
      () => 5,
    );
    await rl.hit("203.0.113.9", policy);
    await rl.hit("203.0.113.9", { ...policy, name: "other" });
    const keys = [...sets.keys()];
    expect(keys).toHaveLength(2);
    expect(keys.join()).not.toContain("203.0.113.9");
    expect(keys.every((k) => /^rl:(t|other):[A-Za-z0-9_-]{43}$/.test(k))).toBe(true);
  });

  it("throws on HTTP or command errors (caller decides fail-open/closed)", async () => {
    const down = (async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
    const rl = new RedisRestRateLimiter({ url: "https://r.test", token: "t", fetch: down });
    await expect(rl.hit("k", policy)).rejects.toThrow("rate_limit_store_http_503");
    const bad = (async () =>
      new Response(JSON.stringify([{ error: "WRONGTYPE" }]))) as unknown as typeof fetch;
    await expect(
      new RedisRestRateLimiter({ url: "https://r.test", token: "t", fetch: bad }).hit("k", policy),
    ).rejects.toThrow("rate_limit_store_command_failed");
  });
});

describe("enforceRateLimit when the store is unavailable", () => {
  beforeEach(() => vi.stubEnv("FIREBASE_PROJECT_ID", "demo-crm"));
  afterEach(() => {
    setRateLimiter(undefined);
    vi.unstubAllEnvs();
  });
  const broken: RateLimiter = { hit: vi.fn(async () => Promise.reject(new Error("down"))) };

  it("fails closed for public / sign-in policies", async () => {
    setRateLimiter(broken);
    await expect(enforceRateLimit(policy, "k")).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("fails open for authenticated per-user policies", async () => {
    setRateLimiter(broken);
    await expect(enforceRateLimit({ ...policy, failOpen: true }, "uid")).resolves.toBeUndefined();
  });
});
