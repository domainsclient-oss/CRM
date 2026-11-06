import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  QUERY_SHAPES,
  needsCompositeIndex,
  type QueryShape,
} from "../../packages/core/src/query-shapes";

// Index coverage (T-03-10, R-04): every query shape that needs a composite index has one,
// and every declared composite index serves a registered shape.

interface IndexField {
  fieldPath: string;
  order?: "ASCENDING" | "DESCENDING";
  arrayConfig?: "CONTAINS";
}
interface CompositeIndex {
  collectionGroup: string;
  queryScope: "COLLECTION" | "COLLECTION_GROUP";
  fields: IndexField[];
}

const file = fileURLToPath(new URL("../firestore.indexes.json", import.meta.url));
const { indexes } = JSON.parse(readFileSync(file, "utf8")) as { indexes: CompositeIndex[] };

function matches(index: CompositeIndex, shape: QueryShape): boolean {
  if (index.collectionGroup !== shape.collection || index.queryScope !== shape.scope) return false;
  const filters = new Set([
    ...shape.equality,
    ...(shape.arrayContains ? [shape.arrayContains] : []),
  ]);
  const head = index.fields.slice(0, filters.size);
  const tail = index.fields.slice(filters.size);
  const headOk = head.every((f) =>
    f.arrayConfig
      ? f.fieldPath === shape.arrayContains
      : filters.has(f.fieldPath) && f.fieldPath !== shape.arrayContains,
  );
  const order = shape.orderBy ?? [];
  const tailOk =
    tail.length === order.length &&
    tail.every((f, i) => f.fieldPath === order[i]!.field && f.order === order[i]!.direction);
  return head.length === filters.size && headOk && tailOk;
}

describe("Firestore index coverage", () => {
  it("query shape ids are unique", () => {
    const ids = QUERY_SHAPES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const shape of QUERY_SHAPES.filter(needsCompositeIndex)) {
    it(`${shape.id} has a matching composite index`, () => {
      expect(indexes.some((index) => matches(index, shape))).toBe(true);
    });
  }

  it("every composite index serves a registered query shape (no unused indexes)", () => {
    const unused = indexes.filter((index) => !QUERY_SHAPES.some((shape) => matches(index, shape)));
    expect(unused).toEqual([]);
  });

  it("detects a missing index (self-test of the matcher)", () => {
    const shape: QueryShape = {
      id: "probe",
      collection: "contacts",
      scope: "COLLECTION",
      equality: ["isDeleted", "ownerUid"],
      orderBy: [{ field: "updatedAt", direction: "DESCENDING" }],
      usedBy: "test",
    };
    const index: CompositeIndex = {
      collectionGroup: "contacts",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "ownerUid", order: "ASCENDING" },
        { fieldPath: "isDeleted", order: "ASCENDING" },
        { fieldPath: "updatedAt", order: "DESCENDING" },
      ],
    };
    expect(needsCompositeIndex(shape)).toBe(true);
    expect(matches(index, shape)).toBe(true);
    expect(matches({ ...index, fields: index.fields.slice(0, 2) }, shape)).toBe(false);
  });
});
