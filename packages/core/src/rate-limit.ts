import "server-only";
import { AppError } from "./errors";
import { logger } from "./logger";
import { RedisRestRateLimiter } from "./rate-limit-redis";
import { getServerEnv } from "./server-env";

// Rate limiting (requirements/04 §9, NFR-SEC-006). Sliding-window log.
// The in-memory backend is per-process (local/test only); hosted environments use the shared
// Redis store (server-env refuses RATE_LIMIT_BACKEND=memory in staging/production).
// Store failures: public and sign-in policies fail closed (the request is refused); policies
// marked `failOpen` (per-user limits behind authentication) let the request through and log.

export interface RateLimitPolicy {
  name: string;
  limit: number;
  windowSeconds: number;
  /** Allow the request if the store is unreachable (authenticated per-user limits only). */
  failOpen?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  hit(key: string, policy: RateLimitPolicy): Promise<RateLimitResult>;
}

/** Policies from requirements/04 §9 (initial values; tune with data). */
export const POLICIES = {
  sessionCreateByIp: { name: "session:ip", limit: 10, windowSeconds: 60 },
  sessionCreateByEmail: { name: "session:email", limit: 20, windowSeconds: 3600 },
  privilegedSignInByIp: { name: "privileged:ip", limit: 5, windowSeconds: 60 },
  invitationAcceptByIp: { name: "invite-accept:ip", limit: 10, windowSeconds: 3600 },
  invitationAcceptByToken: { name: "invite-accept:token", limit: 5, windowSeconds: 3600 },
  passwordResetByIp: { name: "reset:ip", limit: 5, windowSeconds: 3600 },
  provisioningByUser: { name: "provision:uid", limit: 30, windowSeconds: 3600 },
  invitationCreateByTenant: { name: "invite:tenant", limit: 50, windowSeconds: 86400 },
  contactRequestByIp: { name: "contact:ip", limit: 5, windowSeconds: 3600 },
  workspaceFinderByIp: { name: "finder:ip", limit: 5, windowSeconds: 3600 },
  workspaceFinderByEmail: { name: "finder:email", limit: 3, windowSeconds: 3600 },
  importUploadByUser: { name: "import-upload:uid", limit: 20, windowSeconds: 3600 },
  fileDownloadByUser: { name: "download:uid", limit: 60, windowSeconds: 60, failOpen: true },
  vitalsByIp: { name: "vitals:ip", limit: 30, windowSeconds: 60, failOpen: true },
  mutationByUser: { name: "mutation:uid", limit: 120, windowSeconds: 60, failOpen: true },
} as const satisfies Record<string, RateLimitPolicy>;

export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  async hit(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
    const now = this.now();
    const windowStart = now - policy.windowSeconds * 1000;
    const bucketKey = `${policy.name}:${key}`;
    const recent = (this.hits.get(bucketKey) ?? []).filter((t) => t > windowStart);
    if (recent.length >= policy.limit) {
      this.hits.set(bucketKey, recent);
      const oldest = recent[0] ?? now;
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((oldest + policy.windowSeconds * 1000 - now) / 1000),
        ),
      };
    }
    recent.push(now);
    this.hits.set(bucketKey, recent);
    return { allowed: true, remaining: policy.limit - recent.length, retryAfterSeconds: 0 };
  }

  reset(): void {
    this.hits.clear();
  }
}

export class RateLimitError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super("RATE_LIMITED", `retry_after=${retryAfterSeconds}`);
  }
}

let limiter: RateLimiter | undefined;

export function getRateLimiter(): RateLimiter {
  if (limiter) return limiter;
  const backend = getServerEnv().RATE_LIMIT_BACKEND;
  const env = getServerEnv();
  limiter =
    backend === "redis"
      ? new RedisRestRateLimiter({
          url: env.RATE_LIMIT_REDIS_URL!,
          token: env.RATE_LIMIT_REDIS_TOKEN!,
        })
      : new MemoryRateLimiter();
  return limiter;
}

/** Test hook. */
export function setRateLimiter(next: RateLimiter | undefined): void {
  limiter = next;
}

/** Throws RateLimitError when the key exceeds the policy. Keys must not contain raw PII. */
export async function enforceRateLimit(policy: RateLimitPolicy, key: string): Promise<void> {
  // Test-only scaling (rejected in staging/production by server-env).
  const scale = Number(getServerEnv().TEST_RATE_LIMIT_SCALE ?? "1");
  const effective = scale > 1 ? { ...policy, limit: policy.limit * scale } : policy;
  let result: RateLimitResult;
  try {
    result = await getRateLimiter().hit(key, effective);
  } catch (error) {
    logger.error("rate_limit.store_unavailable", {
      policy: policy.name,
      failOpen: Boolean(policy.failOpen),
      error: error instanceof Error ? error.message : "unknown",
    });
    if (policy.failOpen) return;
    throw new AppError("INTERNAL", "rate_limit_store_unavailable");
  }
  if (!result.allowed) throw new RateLimitError(result.retryAfterSeconds);
}
