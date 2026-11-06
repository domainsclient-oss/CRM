import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ForbiddenError, NotFoundError, ValidationError, toActionError } from "./errors";
import { logger } from "./logger";

describe("toActionError", () => {
  it("keeps the code of known errors but replaces internal detail with a safe message", () => {
    const result = toActionError(
      new ForbiddenError("member lacks record.update on c_123"),
      "req_1",
    );
    expect(result).toEqual({
      code: "FORBIDDEN",
      message: "You don't have permission to do that.",
      requestId: "req_1",
    });
    expect(JSON.stringify(result)).not.toContain("c_123");
  });

  it("reports not-found without detail", () => {
    expect(toActionError(new NotFoundError("tenant tnt_other"), "r").message).not.toContain("tnt_");
  });

  it("passes field errors through for validation failures", () => {
    const result = toActionError(new ValidationError({ email: ["Invalid email"] }), "r");
    expect(result.fieldErrors).toEqual({ email: ["Invalid email"] });
  });

  it("converts Zod errors to field errors", () => {
    const parsed = z.object({ name: z.string().min(1) }).safeParse({ name: "" });
    if (parsed.success) throw new Error("expected failure");
    const result = toActionError(parsed.error, "r");
    expect(result.code).toBe("VALIDATION");
    expect(Object.keys(result.fieldErrors ?? {})).toEqual(["name"]);
  });

  it("hides unknown errors behind INTERNAL and logs them server-side", () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const result = toActionError(new Error("db password is hunter2"), "req_x");
    expect(result).toEqual({
      code: "INTERNAL",
      message: "Something went wrong on our side.",
      requestId: "req_x",
    });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
