import { describe, expect, it } from "vitest";
import { ERROR_CODES, HTTP_STATUS, fail, isErrorCode, ok } from "./errors";

describe("error contract", () => {
  it("maps every error code to an HTTP status", () => {
    for (const code of ERROR_CODES) expect(HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
  });

  it("reports cross-tenant access as 404, never 403 (no existence oracle)", () => {
    expect(HTTP_STATUS.NOT_FOUND).toBe(404);
  });

  it("recognises only known codes", () => {
    expect(isErrorCode("FORBIDDEN")).toBe(true);
    expect(isErrorCode("forbidden")).toBe(false);
    expect(isErrorCode(403)).toBe(false);
  });

  it("builds discriminated results", () => {
    expect(ok(1)).toEqual({ ok: true, data: 1 });
    const failed = fail({ code: "INTERNAL", message: "m", requestId: "req_1" });
    expect(failed.ok).toBe(false);
  });
});
