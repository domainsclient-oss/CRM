import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { RateLimitPolicy, RateLimitResult, RateLimiter } from "./rate-limit";

// Shared rate-limit store for hosted environments (ADR-013, OQ-07: Upstash Redis over its REST
// API, so no client library or TCP connection from serverless functions).
//
// Sliding-window log in a sorted set per (policy, key), applied atomically with MULTI/EXEC:
// drop entries older than the window, add this hit, count, refresh the TTL, read the oldest.
// A refused hit is removed again, so blocked attempts don't extend the lockout (same behaviour
// as the in-memory limiter). Keys are hashed: IP addresses and similar never reach Redis.

export interface RedisRestConfig {
  url: string;
  token: string;
  /** Per-call timeout; a slow store must not hold requests open. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

type Command = Array<string | number>;
type Reply = { result?: unknown; error?: string };

export class RedisRestRateLimiter implements RateLimiter {
  private readonly fetcher: typeof fetch;

  constructor(
    private readonly config: RedisRestConfig,
    private readonly now: () => number = Date.now,
  ) {
    this.fetcher = config.fetch ?? fetch;
  }

  private async exec(commands: Command[], transaction: boolean): Promise<unknown[]> {
    const response = await this.fetcher(
      `${this.config.url.replace(/\/$/, "")}/${transaction ? "multi-exec" : "pipeline"}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(commands.map((c) => c.map(String))),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 1500),
        cache: "no-store",
      },
    );
    if (!response.ok) throw new Error(`rate_limit_store_http_${response.status}`);
    const replies = (await response.json()) as Reply[];
    const failed = replies.find((r) => r.error);
    if (failed) throw new Error("rate_limit_store_command_failed");
    return replies.map((r) => r.result);
  }

  async hit(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
    const now = this.now();
    const windowMs = policy.windowSeconds * 1000;
    const bucket = `rl:${policy.name}:${createHash("sha256").update(key).digest("base64url")}`;
    const member = `${now}:${randomUUID()}`;
    const [, , count, , oldest] = await this.exec(
      [
        ["ZREMRANGEBYSCORE", bucket, 0, now - windowMs],
        ["ZADD", bucket, now, member],
        ["ZCARD", bucket],
        ["PEXPIRE", bucket, windowMs],
        ["ZRANGE", bucket, 0, 0, "WITHSCORES"],
      ],
      true,
    );
    const total = Number(count);
    if (total <= policy.limit) {
      return { allowed: true, remaining: policy.limit - total, retryAfterSeconds: 0 };
    }
    await this.exec([["ZREM", bucket, member]], false);
    const oldestScore = Number((oldest as unknown[] | undefined)?.[1] ?? now);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldestScore + windowMs - now) / 1000)),
    };
  }
}
