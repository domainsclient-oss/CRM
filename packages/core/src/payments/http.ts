import "server-only";
import { GatewayError, type PaymentProvider } from "./types";

// Minimal JSON/form HTTP client for gateway APIs. Never logs or returns provider payloads in errors
// (they can contain customer details); errors carry provider + HTTP status + provider error code.

export type Fetch = typeof fetch;

export interface CallOptions {
  method?: "GET" | "POST" | "DELETE";
  auth: string;
  json?: unknown;
  form?: Record<string, string>;
  headers?: Record<string, string>;
}

export async function callGateway<T>(
  fetcher: Fetch,
  provider: PaymentProvider,
  url: string,
  opts: CallOptions,
): Promise<T> {
  const headers: Record<string, string> = { Authorization: opts.auth, ...opts.headers };
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  }
  let res: Response;
  try {
    res = await fetcher(url, {
      method: opts.method ?? (body ? "POST" : "GET"),
      headers,
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    throw new GatewayError(provider, 0, "unreachable");
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const err = (data?.error ?? data) as Record<string, unknown> | null;
    const code = String(err?.code ?? err?.name ?? err?.type ?? "error")
      .replace(/[^A-Za-z0-9_]/g, "_")
      .slice(0, 40);
    throw new GatewayError(provider, res.status, code);
  }
  return data as T;
}

export const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
