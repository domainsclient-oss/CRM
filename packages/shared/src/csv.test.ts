import { describe, expect, it } from "vitest";
import { detectDelimiter, neutralizeFormula, parseCsv, toCsv } from "./csv";

describe("CSV", () => {
  it("parses quotes, escaped quotes, newlines in fields, BOM, and CRLF", () => {
    const csv = '﻿Name,Notes\r\n"Doe, Jane","said ""hi""\nthen left"\r\nRaj,ok\r\n';
    expect(parseCsv(csv)).toEqual({
      header: ["Name", "Notes"],
      rows: [
        ["Doe, Jane", 'said "hi"\nthen left'],
        ["Raj", "ok"],
      ],
    });
  });

  it("detects semicolon files and skips blank lines", () => {
    expect(detectDelimiter("a;b;c\n1,2;3")).toBe(";");
    expect(parseCsv("a;b\n\n1;2\n")).toEqual({ header: ["a", "b"], rows: [["1", "2"]] });
  });

  it("stops at maxRows and rejects unterminated quotes", () => {
    expect(parseCsv("h\n1\n2\n3\n", 2).rows).toEqual([["1"], ["2"]]);
    expect(() => parseCsv('h\n"oops')).toThrow(/Unterminated/);
  });

  it.each(["=SUM(A1)", "+1", "-1", "@cmd", "\tx", "\rx"])(
    "neutralises formula-like cell %j (TC-IMP-002)",
    (value) => {
      expect(neutralizeFormula(value)).toBe(`'${value}`);
    },
  );

  it("serializes with quoting and protection", () => {
    expect(
      toCsv([
        ["a", "b"],
        ["=1+1", 'x,"y"'],
        [null, ["t1", "t2"]],
      ]),
    ).toBe('﻿a,b\r\n\'=1+1,"x,""y"""\r\n,"t1; t2"\r\n');
    // Round trip.
    expect(parseCsv(toCsv([["n"], ["Doe, Jane"]])).rows).toEqual([["Doe, Jane"]]);
  });
});
