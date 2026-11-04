import { describe, expect, test } from "vitest";
import { docx } from "./support/docx-fixture";

const HYPERLINK = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const rel = (id: string): string =>
  `<Relationship Id="${id}" Type="${HYPERLINK}" Target="https://example.com" TargetMode="External"/>`;

describe("the docx fixture builder", () => {
  test("rejects a test relationship id that takes the fixture's own rIdFixture prefix", () => {
    expect(() => docx({ body: "<w:p/>", rels: rel("rIdFixture-styles") })).toThrow(/rIdFixture/);
  });

  test("accepts a test relationship id outside the fixture's prefix", () => {
    expect(docx({ body: "<w:p/>", rels: rel("rId1") })).toBeInstanceOf(Uint8Array);
  });
});
