import "server-only";
import { getAdminApp } from "../firebase-admin";
import { getServerEnv } from "../server-env";

// Hosting + auth integrations for custom domains (FR-TEN-005, ADR-022, R-02).
// - DomainProvider: register a host with the hosting project and report verification status.
// - AuthDomainSync: keep Firebase Auth's authorized domains in step with active hosts.
// Real adapters call the Vercel Domains API and the Identity Toolkit admin API. Their endpoints
// and payloads MUST be re-verified against current docs in T-01-09 before production use; local,
// test and E2E runs use deterministic mocks (TEST_VERCEL_DOMAINS_MOCK).

export interface DnsRecord {
  type: "CNAME" | "A" | "TXT";
  name: string;
  value: string;
}

export interface DomainStatus {
  /** Ownership verified with the hosting provider. */
  verified: boolean;
  /** DNS points at the hosting provider (certificate can be issued). */
  configured: boolean;
  records: DnsRecord[];
  error: string | null;
}

export interface DomainProvider {
  name: string;
  add(host: string): Promise<DomainStatus>;
  status(host: string): Promise<DomainStatus>;
  remove(host: string): Promise<void>;
}

export interface AuthDomainSync {
  add(host: string): Promise<void>;
  remove(host: string): Promise<void>;
}

/** DNS names never carry the dev-only port. */
const bare = (host: string) => host.split(":")[0]!;
const isApex = (host: string) => bare(host).split(".").length === 2;

/** Records the client must create (subdomain → CNAME; apex → A). */
export function expectedRecords(host: string, verification: DnsRecord[] = []): DnsRecord[] {
  const route: DnsRecord = isApex(host)
    ? { type: "A", name: "@", value: "76.76.21.21" }
    : { type: "CNAME", name: bare(host).split(".")[0]!, value: "cname.vercel-dns.com" };
  return [route, ...verification];
}

/**
 * Deterministic mock: hosts containing "pending" never verify, hosts containing "fail" error,
 * everything else verifies on the first status check.
 */
export class MockDomainProvider implements DomainProvider {
  name = "mock";
  readonly removed: string[] = [];
  async add(host: string): Promise<DomainStatus> {
    if (host.includes("fail")) {
      return { verified: false, configured: false, records: [], error: "domain_rejected" };
    }
    return {
      verified: false,
      configured: false,
      records: expectedRecords(host, [
        {
          type: "TXT",
          name: `_vercel.${bare(host)}`,
          value: `vc-domain-verify=${bare(host)},mock`,
        },
      ]),
      error: null,
    };
  }
  async status(host: string): Promise<DomainStatus> {
    const ok = !host.includes("pending") && !host.includes("fail");
    return {
      verified: ok,
      configured: ok,
      records: expectedRecords(host),
      error: host.includes("fail") ? "domain_rejected" : null,
    };
  }
  async remove(host: string): Promise<void> {
    this.removed.push(host);
  }
}

export class MockAuthDomainSync implements AuthDomainSync {
  readonly domains = new Set<string>();
  async add(host: string) {
    this.domains.add(host);
  }
  async remove(host: string) {
    this.domains.delete(host);
  }
}

/** Vercel Domains API adapter (verify endpoints in T-01-09). */
export class VercelDomainProvider implements DomainProvider {
  name = "vercel";
  constructor(
    private readonly token: string,
    private readonly projectId: string,
    private readonly teamId: string | undefined,
  ) {}

  private url(path: string) {
    const u = new URL(`https://api.vercel.com${path}`);
    if (this.teamId) u.searchParams.set("teamId", this.teamId);
    return u.toString();
  }

  private async call(method: string, path: string, body?: unknown) {
    const res = await fetch(this.url(path), {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, json };
  }

  private toStatus(host: string, json: Record<string, unknown>, configured: boolean): DomainStatus {
    const verification = ((json.verification as Array<Record<string, string>>) ?? []).map(
      (v): DnsRecord => ({
        type: "TXT",
        name: v.domain ?? `_vercel.${host}`,
        value: v.value ?? "",
      }),
    );
    return {
      verified: json.verified === true,
      configured,
      records: expectedRecords(host, verification),
      error: null,
    };
  }

  async add(host: string): Promise<DomainStatus> {
    const res = await this.call("POST", `/v10/projects/${this.projectId}/domains`, { name: host });
    if (!res.ok && res.status !== 409) {
      return { verified: false, configured: false, records: [], error: `vercel_${res.status}` };
    }
    return this.status(host);
  }

  async status(host: string): Promise<DomainStatus> {
    const domain = await this.call("GET", `/v9/projects/${this.projectId}/domains/${host}`);
    if (!domain.ok) {
      return { verified: false, configured: false, records: [], error: `vercel_${domain.status}` };
    }
    if (domain.json.verified !== true) {
      await this.call("POST", `/v9/projects/${this.projectId}/domains/${host}/verify`);
    }
    const config = await this.call("GET", `/v6/domains/${host}/config`);
    return this.toStatus(host, domain.json, config.ok && config.json.misconfigured === false);
  }

  async remove(host: string): Promise<void> {
    await this.call("DELETE", `/v9/projects/${this.projectId}/domains/${host}`);
  }
}

/** Firebase Auth authorized domains via the Identity Toolkit admin API (verify in T-01-09). */
export class IdentityToolkitAuthDomainSync implements AuthDomainSync {
  private async request(method: "GET" | "PATCH", body?: unknown) {
    const credential = getAdminApp().options.credential;
    if (!credential) throw new Error("auth_domain_sync_requires_credentials");
    const { access_token } = await credential.getAccessToken();
    const project = getServerEnv().FIREBASE_PROJECT_ID;
    const base = `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`;
    const res = await fetch(method === "PATCH" ? `${base}?updateMask=authorizedDomains` : base, {
      method,
      headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`identitytoolkit_${res.status}`);
    return (await res.json()) as { authorizedDomains?: string[] };
  }
  private async update(change: (domains: Set<string>) => void) {
    const config = await this.request("GET");
    const domains = new Set(config.authorizedDomains ?? []);
    change(domains);
    await this.request("PATCH", { authorizedDomains: [...domains] });
  }
  add(host: string) {
    return this.update((d) => d.add(host));
  }
  remove(host: string) {
    return this.update((d) => d.delete(host));
  }
}

let providers: { domains: DomainProvider; auth: AuthDomainSync } | undefined;

export function setDomainProviders(next: typeof providers): void {
  providers = next;
}

export function getDomainProviders(): { domains: DomainProvider; auth: AuthDomainSync } {
  if (providers) return providers;
  const env = getServerEnv();
  const mock =
    env.TEST_VERCEL_DOMAINS_MOCK === "true" ||
    ((env.APP_ENV === "local" || env.APP_ENV === "test") && !env.VERCEL_API_TOKEN);
  if (mock) {
    providers = { domains: new MockDomainProvider(), auth: new MockAuthDomainSync() };
  } else {
    if (!env.VERCEL_API_TOKEN || !env.VERCEL_PROJECT_ID_WEB) {
      throw new Error("VERCEL_API_TOKEN and VERCEL_PROJECT_ID_WEB are required for domains");
    }
    providers = {
      domains: new VercelDomainProvider(
        env.VERCEL_API_TOKEN,
        env.VERCEL_PROJECT_ID_WEB,
        env.VERCEL_TEAM_ID,
      ),
      auth: new IdentityToolkitAuthDomainSync(),
    };
  }
  return providers;
}
