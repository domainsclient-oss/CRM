import "server-only";
import { z } from "zod";
import { fail, ok, type ActionResult } from "@crm/shared/errors";
import { isSameOrigin, normalizeHost } from "@crm/shared/hosts";
import type {
  AgencyPermission,
  PlatformPermission,
  WorkspacePermission,
} from "@crm/shared/permissions";
import { authorize, authorizeAgency, authorizePlatform } from "../authz";
import { READ_ONLY_ALLOWED, getEffectiveConfig } from "../config/entitlements";
import { requireAgencyContext, type AgencyContext } from "../contexts/agency-context";
import { requirePlatformContext, type PlatformContext } from "../contexts/platform-context";
import { requireTenantContext, type TenantContext } from "../contexts/tenant-context";
import { AppError, toActionError } from "../errors";
import { enforceRateLimit, type RateLimitPolicy } from "../rate-limit";
import { logger } from "../logger";
import { newRequestId } from "../request-id";
import { assertRecentAuth, sessionPolicy, type SessionKind } from "../session";

// Server Action wrappers (requirements/02 §6.1, T-03-07). EVERY exported Server Action
// must be built with one of these. Server Actions are public POST endpoints: the wrapper
// authenticates, authorizes, rate-limits, validates (strict), and maps errors to safe results.

/** Framework-neutral view of the incoming request, provided by each app's adapter. */
export interface RequestInfo {
  host: string;
  origin: string | null;
  secure: boolean;
  ip: string | null;
  userAgent: string | null;
  cookie(name: string): string | undefined;
}
export type RequestSource = () => Promise<RequestInfo>;

export type ActionKind = "tenant" | "agency" | "platform" | "public";

export interface RegisteredAction {
  name: string;
  kind: ActionKind;
  permission: string | null;
}

/** All wrapped actions, for registry-driven isolation tests (requirements/09 §5). */
export const ACTION_REGISTRY = new Map<string, RegisteredAction>();

/** Marks a function built by these wrappers, so tests can prove every export is wrapped. */
export const ACTION_META = Symbol.for("crm.action");

/** The registry entry of a wrapped action, or undefined for anything else. */
export function actionMeta(fn: unknown): RegisteredAction | undefined {
  if (typeof fn !== "function") return undefined;
  return (fn as unknown as Record<symbol, RegisteredAction | undefined>)[ACTION_META];
}

function tagged<F extends (raw: unknown) => Promise<unknown>>(entry: RegisteredAction, fn: F): F {
  Object.defineProperty(fn, ACTION_META, { value: entry });
  return fn;
}

function register(entry: RegisteredAction): RegisteredAction {
  const existing = ACTION_REGISTRY.get(entry.name);
  // Re-registering the identical definition is fine (dev hot reload re-runs modules);
  // reusing a name for a different action is a bug.
  if (existing && (existing.kind !== entry.kind || existing.permission !== entry.permission)) {
    throw new Error(`Duplicate action name: ${entry.name}`);
  }
  ACTION_REGISTRY.set(entry.name, entry);
  return entry;
}

/** Next.js lets requests without an Origin header through; we don't (requirements/04 §8). */
export function assertSameOrigin(req: RequestInfo): string {
  const host = normalizeHost(req.host);
  if (!host || !isSameOrigin(req.origin, host)) throw new AppError("FORBIDDEN", "cross_origin");
  return host;
}

/**
 * Workspace lifecycle gates shared by tenant actions and tenant Route Handlers:
 * pending deletion allows only cancelling (FR-TEN-006 AC2); read-only workspaces (billing past
 * grace / expired trial) keep read, export and billing access.
 */
export async function assertWorkspaceState(
  ctx: TenantContext,
  name: string,
  permission: WorkspacePermission,
): Promise<void> {
  if (ctx.tenant.status === "pending_deletion" && name !== "tenant.cancelDeletion") {
    throw new AppError("TENANT_SUSPENDED", "pending_deletion");
  }
  if (!READ_ONLY_ALLOWED.has(permission) && (await getEffectiveConfig(ctx)).readOnly) {
    throw new AppError("BILLING_READ_ONLY", "read_only");
  }
}

type StrictSchema = z.ZodObject<z.ZodRawShape>;

interface BaseOptions<S extends StrictSchema> {
  /** Unique, stable name (also the rate-limit and registry key), e.g. "tenants.create". */
  name: string;
  schema: S;
  rateLimit?: RateLimitPolicy;
  /** Require a sign-in within the re-auth window (sensitive operations). */
  reauth?: boolean;
}

function parseStrict<S extends StrictSchema>(schema: S, raw: unknown): z.infer<S> {
  // Unknown keys (e.g. tenantId, role, ownerUid smuggled by a client) are rejected.
  return schema.strict().parse(raw) as z.infer<S>;
}

/** Who was refused, for the `authz.denied` security metric (10 §10). Pseudonymous IDs only. */
interface Actor {
  uid?: string;
  tenantId?: string;
  agencyId?: string;
}

async function run<T>(
  entry: RegisteredAction,
  fn: (requestId: string, actor: Actor) => Promise<T>,
): Promise<ActionResult<T>> {
  const requestId = newRequestId();
  const actor: Actor = {};
  try {
    return ok(await fn(requestId, actor));
  } catch (error) {
    const result = toActionError(error, requestId);
    if (result.code === "FORBIDDEN") {
      logger.warn("authz.denied", {
        requestId,
        action: entry.name,
        context: entry.kind,
        reason: error instanceof AppError ? error.message.slice(0, 120) : "forbidden",
        ...actor,
      });
    }
    return fail(result);
  }
}

function cookieFor(req: RequestInfo, kind: SessionKind): string | undefined {
  return req.cookie(sessionPolicy(kind, req.secure).cookieName);
}

export function createActionWrappers(source: RequestSource) {
  return {
    tenant<S extends StrictSchema, R>(
      opts: BaseOptions<S> & {
        permission: WorkspacePermission;
        handler: (ctx: TenantContext, input: z.infer<S>, req: RequestInfo) => Promise<R>;
      },
    ) {
      const entry = register({ name: opts.name, kind: "tenant", permission: opts.permission });
      return tagged(entry, async (raw: unknown) =>
        run(entry, async (requestId, actor) => {
          const req = await source();
          const host = assertSameOrigin(req);
          const ctx = await requireTenantContext({
            host,
            sessionCookie: cookieFor(req, "workspace"),
            requestId,
          });
          Object.assign(actor, { uid: ctx.uid, tenantId: ctx.tenantId, agencyId: ctx.agencyId });
          authorize(ctx, opts.permission);
          await assertWorkspaceState(ctx, opts.name, opts.permission);
          if (opts.reauth) assertRecentAuth(ctx.session);
          await enforceRateLimit(opts.rateLimit ?? { ...defaultPolicy, name: opts.name }, ctx.uid);
          return opts.handler(ctx, parseStrict(opts.schema, raw), req);
        }),
      );
    },

    agency<S extends StrictSchema, R>(
      opts: BaseOptions<S> & {
        permission: AgencyPermission;
        handler: (ctx: AgencyContext, input: z.infer<S>, req: RequestInfo) => Promise<R>;
      },
    ) {
      const entry = register({ name: opts.name, kind: "agency", permission: opts.permission });
      return tagged(entry, async (raw: unknown) =>
        run(entry, async (requestId, actor) => {
          const req = await source();
          const host = assertSameOrigin(req);
          const ctx = await requireAgencyContext({
            host,
            sessionCookie: cookieFor(req, "partners"),
            selectedAgencyId: req.cookie("agency"),
            requestId,
          });
          Object.assign(actor, { uid: ctx.uid, agencyId: ctx.agencyId });
          authorizeAgency(ctx, opts.permission);
          if (opts.reauth) assertRecentAuth(ctx.session);
          await enforceRateLimit(opts.rateLimit ?? { ...defaultPolicy, name: opts.name }, ctx.uid);
          return opts.handler(ctx, parseStrict(opts.schema, raw), req);
        }),
      );
    },

    platform<S extends StrictSchema, R>(
      opts: BaseOptions<S> & {
        permission: PlatformPermission;
        handler: (ctx: PlatformContext, input: z.infer<S>, req: RequestInfo) => Promise<R>;
      },
    ) {
      const entry = register({ name: opts.name, kind: "platform", permission: opts.permission });
      return tagged(entry, async (raw: unknown) =>
        run(entry, async (requestId, actor) => {
          const req = await source();
          const host = assertSameOrigin(req);
          const ctx = await requirePlatformContext({
            host,
            sessionCookie: cookieFor(req, "console"),
            requestId,
          });
          Object.assign(actor, { uid: ctx.uid });
          authorizePlatform(ctx, opts.permission);
          if (opts.reauth) assertRecentAuth(ctx.session);
          await enforceRateLimit(opts.rateLimit ?? { ...defaultPolicy, name: opts.name }, ctx.uid);
          return opts.handler(ctx, parseStrict(opts.schema, raw), req);
        }),
      );
    },

    /**
     * Unauthenticated actions (e.g. accepting an invitation before an account exists).
     * Same-origin and an IP rate limit are mandatory; the handler must authorize via
     * its own proof (e.g. a single-use token).
     */
    public<S extends StrictSchema, R>(
      opts: Omit<BaseOptions<S>, "reauth"> & {
        rateLimit: RateLimitPolicy;
        handler: (input: z.infer<S>, req: RequestInfo & { requestId: string }) => Promise<R>;
      },
    ) {
      const entry = register({ name: opts.name, kind: "public", permission: null });
      return tagged(entry, async (raw: unknown) =>
        run(entry, async (requestId, actor) => {
          const req = await source();
          assertSameOrigin(req);
          await enforceRateLimit(opts.rateLimit, req.ip ?? "unknown-ip");
          return opts.handler(parseStrict(opts.schema, raw), { ...req, requestId });
        }),
      );
    },
  };
}

// Authenticated per-user default: abuse control, so a store outage lets requests through.
const defaultPolicy = { limit: 120, windowSeconds: 60, failOpen: true };
