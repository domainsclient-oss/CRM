import { describe, expect, it } from "vitest";
import { contactInput } from "./records/schemas";
import { rowToInput, suggestMapping } from "./import";

describe("CSV import mapping (FR-IMP-001)", () => {
  it("suggests fields from headers, preferring exact names and using each field once", () => {
    expect(
      suggestMapping(["Name", "First Name", "E-mail address", "Mobile", "Unknown"], "contacts"),
    ).toEqual([null, "firstName", "email", "phone", null]);
    expect(suggestMapping(["Company", "Website", "Country"], "companies")).toEqual([
      "name",
      "website",
      "country",
    ]);
  });

  it("maps rows to schema input that the shared schema validates", () => {
    const input = rowToInput(
      "contacts",
      ["Ann", "ann@acme.test", "+1 555 0100", "vip; new"],
      ["firstName", "email", "phone", "tags"],
    );
    expect(contactInput.parse(input)).toMatchObject({
      firstName: "Ann",
      email: "ann@acme.test",
      phones: [{ label: "work", number: "+1 555 0100" }],
      tags: ["vip", "new"],
    });
  });
});
