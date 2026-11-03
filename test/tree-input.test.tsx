import { describe, expect, test } from "vitest";
import { TreeError, renderToBase64, renderToBuffer, renderToTree } from "../src/index";
import { CASES } from "./support/cases";
import { docxXml } from "./support/docx-xml";

function caseNamed(name: string) {
  const found = CASES.find((c) => c.name === name);
  if (found === undefined) throw new Error(`no characterization case "${name}"`);
  return found.element;
}

describe("a canonical tree renders like the JSX it came from", () => {
  for (const { name, element } of CASES) {
    test(name, async () => {
      const fromTree = docxXml(await renderToBuffer(renderToTree(element)));
      expect(fromTree).toEqual(docxXml(await renderToBuffer(element)));
    });
  }

  test("the tree is plain data: a JSON round trip renders identically", async () => {
    const element = caseNamed("page-number-children");
    const tree = renderToTree(element);
    const roundTripped = JSON.parse(JSON.stringify(tree));
    expect(roundTripped).toEqual(tree);
    expect(docxXml(await renderToBuffer(roundTripped))).toEqual(docxXml(await renderToBuffer(element)));
  });
});

test("renderToBase64 decodes to the same document as renderToBuffer", async () => {
  const element = caseNamed("table");
  const decoded = Buffer.from(await renderToBase64(element), "base64");
  expect(docxXml(decoded)).toEqual(docxXml(await renderToBuffer(element)));
});

test("renderToTree throws a TreeError when nothing rendered", () => {
  const Empty = () => null;
  expect(() => renderToTree(<Empty />)).toThrow(TreeError);
  expect(() => renderToTree(<Empty />)).toThrow("Nothing rendered; the root must be <Document>");
});
