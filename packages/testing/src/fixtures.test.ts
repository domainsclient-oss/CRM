import { describe, expect, it } from "vitest";
import { SAMPLE_PATHS, WORKSPACES, buildContact, uidFor } from "./fixtures";

describe("fixtures", () => {
  it("sample paths are valid Firestore document paths (even segment count)", () => {
    for (const path of SAMPLE_PATHS) expect(path.split("/").length % 2, path).toBe(0);
  });

  it("workspaces of the same agency and different agencies both exist (isolation cases)", () => {
    expect(WORKSPACES.acme.agencyId).toBe(WORKSPACES.globex.agencyId);
    expect(WORKSPACES.acme.agencyId).not.toBe(WORKSPACES.initech.agencyId);
  });

  it("builds contacts owned by the given member", () => {
    const contact = buildContact("acme", "c_1", uidFor("acme", "member"));
    expect(contact).toMatchObject({
      tenantId: "tnt_acme",
      ownerUid: "u_acme_member",
      isDeleted: false,
    });
  });
});
