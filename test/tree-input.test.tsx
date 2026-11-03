import { useLayoutEffect, useState } from "react";
import { describe, expect, test } from "vitest";
import { Document, Paragraph, Section, TreeError, renderToBase64, renderToBuffer, renderToTree } from "../src/index";
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
  expect(() => renderToTree(<Empty />)).toThrow(/^Nothing rendered/);
});

test("a state update that reorders keyed children renders them in the new order, each once", () => {
  function Reordered() {
    const [order, setOrder] = useState(["a", "b", "c", "d"]);
    useLayoutEffect(() => setOrder(["d", "c", "x", "a"]), []);
    return (
      <>
        {order.map((key) => (
          <Paragraph key={key}>{key}</Paragraph>
        ))}
      </>
    );
  }
  const tree = renderToTree(
    <Document>
      <Section>
        <Reordered />
      </Section>
    </Document>
  );
  const texts = tree.children[0].children.map((paragraph) => JSON.stringify(paragraph.children));
  expect(texts).toEqual(["d", "c", "x", "a"].map((text) => JSON.stringify([{ type: "TextRun", props: {}, children: [text] }])));
});
