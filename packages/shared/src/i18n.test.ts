import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "./errors";
import { errorMessage, t } from "./i18n";

describe("t()", () => {
  it("interpolates placeholders as plain text", () => {
    expect(t("common.supportReference", { requestId: "req_abc" })).toBe(
      "Support reference: req_abc",
    );
  });

  it("leaves unknown placeholders visible so gaps show up in review", () => {
    expect(t("common.supportReference", { other: "x" })).toBe("Support reference: {requestId}");
  });

  it("does not interpret HTML in values (escaping is React's job)", () => {
    expect(t("common.supportReference", { requestId: "<b>x</b>" })).toContain("<b>x</b>");
  });

  it("has a user-facing message for every error code", () => {
    for (const code of ERROR_CODES) expect(errorMessage(code)).toMatch(/\w/);
  });
});
