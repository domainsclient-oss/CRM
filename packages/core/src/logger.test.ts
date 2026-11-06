import { describe, expect, it } from "vitest";
import { createLogger, redact, type LogLevel } from "./logger";

function capture(level: LogLevel = "debug") {
  const lines: Array<Record<string, unknown>> = [];
  const log = createLogger({ level, write: (line) => lines.push(JSON.parse(line)) });
  return { log, lines };
}

describe("logger", () => {
  it("writes structured JSON with Cloud Logging severity", () => {
    const { log, lines } = capture();
    log.warn("thing.happened", { requestId: "req_1", tenantId: "tnt_1" });
    expect(lines[0]).toMatchObject({
      severity: "WARNING",
      message: "thing.happened",
      requestId: "req_1",
      tenantId: "tnt_1",
    });
  });

  it("drops entries below the configured level", () => {
    const { log, lines } = capture("warn");
    log.info("ignored");
    log.error("kept");
    expect(lines.map((l) => l.message)).toEqual(["kept"]);
  });

  it("carries child bindings", () => {
    const { log, lines } = capture();
    log.child({ requestId: "req_9" }).info("x");
    expect(lines[0]?.requestId).toBe("req_9");
  });

  it("redacts sensitive keys at any depth (NFR-OBS-001)", () => {
    const out = redact({
      email: "a@b.example",
      nested: { password: "p", privateKey: "k", authorization: "Bearer t", ok: "fine" },
      cookie: "session=abc",
    }) as Record<string, unknown>;
    expect(out.email).toBe("[redacted]");
    expect(out.cookie).toBe("[redacted]");
    expect(out.nested).toEqual({
      password: "[redacted]",
      privateKey: "[redacted]",
      authorization: "[redacted]",
      ok: "fine",
    });
  });

  it("serialises errors without stack traces", () => {
    const err = Object.assign(new Error("boom"), { code: "permission-denied" });
    const out = redact({ error: err }) as { error: Record<string, unknown> };
    expect(out.error).toEqual({ name: "Error", message: "boom", code: "permission-denied" });
  });

  it("truncates very long strings", () => {
    expect(String(redact("a".repeat(2000))).length).toBeLessThan(600);
  });

  it("scrubs emails, JWTs, bearer credentials and private keys from values (TC-OBS-001)", () => {
    const { log, lines } = capture();
    const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1XzEifQ.c2lnbmF0dXJlLXZhbHVl";
    log.error("auth failed for raj@acme.test", {
      error: new Error(`There is no user record for raj@acme.test (token ${jwt})`),
      detail: "Authorization: Bearer abcdefghijklmnop",
      blob: "-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----",
      nested: { list: ["lena@globex.test"] },
    });
    const out = JSON.stringify(lines[0]);
    for (const leaked of ["raj@acme.test", "lena@globex.test", jwt, "abcdefghijklmnop", "MIIEvQ"]) {
      expect(out).not.toContain(leaked);
    }
    expect(out).toContain("[email]");
    expect(out).toContain("[jwt]");
  });

  it("redacts IP addresses and user agents by key", () => {
    expect(redact({ ip: "203.0.113.9", ipAddress: "x", userAgent: "UA", zip: "12345" })).toEqual({
      ip: "[redacted]",
      ipAddress: "[redacted]",
      userAgent: "[redacted]",
      zip: "12345",
    });
  });

  it("keeps pseudonymous IDs needed for tracing (requestId, tenantId, agencyId, uid)", () => {
    const { log, lines } = capture();
    log
      .child({ requestId: "req_1", tenantId: "tnt_1", uid: "u_1" })
      .info("x", { agencyId: "agy_1" });
    expect(lines[0]).toMatchObject({
      requestId: "req_1",
      tenantId: "tnt_1",
      uid: "u_1",
      agencyId: "agy_1",
    });
  });
});
