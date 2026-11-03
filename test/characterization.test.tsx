import { describe, expect, test } from "vitest";
import { renderToBuffer } from "../src/index";
import { CASES } from "./support/cases";
import { docxXml } from "./support/docx-xml";

describe("writer output today", () => {
  for (const { name, element, bug } of CASES) {
    test(bug ? `[bug] ${name}` : name, async () => {
      expect(docxXml(await renderToBuffer(element))).toMatchSnapshot();
    });
  }

  test("output is stable across two renders", async () => {
    for (const { element } of CASES) {
      const first = docxXml(await renderToBuffer(element));
      const second = docxXml(await renderToBuffer(element));
      expect(second).toEqual(first);
    }
  });
});
