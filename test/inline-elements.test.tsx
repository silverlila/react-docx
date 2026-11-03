import type { ReactElement } from "react";
import { describe, expect, test } from "vitest";
import {
  Break,
  CarriageReturn,
  CheckBox,
  ColumnBreak,
  DayLong,
  DayShort,
  DeletedTextRun,
  Document,
  InsertedTextRun,
  MonthLong,
  MonthShort,
  NoBreakHyphen,
  PageReference,
  Paragraph,
  PositionalTab,
  Section,
  SequentialIdentifier,
  SimpleField,
  SimpleMailMergeField,
  SoftHyphen,
  TextRun,
  YearLong,
  YearShort,
  renderToBuffer,
  renderToTree,
} from "../src/index";
import { docxXml } from "./support/docx-xml";

/** word/document.xml's body, with docxXml's pretty-printing undone so one element sits on one line. */
async function bodyXml(inline: ReactElement): Promise<string> {
  const xml = docxXml(await renderToBuffer(<Document>{section(inline)}</Document>))["word/document.xml"];
  const body = xml.replaceAll("\n", "").match(/<w:body>(.*)<w:sectPr>/);
  if (body === null) throw new Error("word/document.xml has no <w:body>");
  return body[1];
}

const section = (inline: ReactElement) => (
  <Section>
    <Paragraph>{inline}</Paragraph>
  </Section>
);

const change = { id: 1, author: "A", date: "2026-01-01T00:00:00Z" } as const;
const changeAttributes = 'w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"';

describe("tracked changes", () => {
  test("<InsertedTextRun> with string children writes a w:ins around a run of w:t", async () => {
    expect(await bodyXml(<InsertedTextRun {...change}>ins</InsertedTextRun>)).toBe(
      `<w:p><w:ins ${changeAttributes}><w:r><w:t xml:space="preserve">ins</w:t></w:r></w:ins></w:p>`
    );
  });

  test("<DeletedTextRun> with string children writes a w:del around a run of w:delText", async () => {
    expect(await bodyXml(<DeletedTextRun {...change}>del</DeletedTextRun>)).toBe(
      `<w:p><w:del ${changeAttributes}><w:r><w:delText xml:space="preserve">del</w:delText></w:r></w:del></w:p>`
    );
  });

  describe("<DeletedTextRun>a<Break/>b</DeletedTextRun>", () => {
    const split = (
      <DeletedTextRun {...change}>
        a<Break />b
      </DeletedTextRun>
    );

    test("canonicalizes to two DeletedTextRuns, the second with break: 1", () => {
      const paragraph = renderToTree(<Document>{section(split)}</Document>).children[0].children[0];
      expect(paragraph.children).toEqual([
        { type: "DeletedTextRun", props: change, children: ["a"] },
        { type: "DeletedTextRun", props: { ...change, break: 1 }, children: ["b"] },
      ]);
    });

    test("writes two w:del, the second holding the w:br", async () => {
      expect(await bodyXml(split)).toBe(
        "<w:p>" +
          `<w:del ${changeAttributes}><w:r><w:delText xml:space="preserve">a</w:delText></w:r></w:del>` +
          `<w:del ${changeAttributes}><w:r><w:br/><w:delText xml:space="preserve">b</w:delText></w:r></w:del>` +
          "</w:p>"
      );
    });
  });
});

describe("inline elements", () => {
  test("<ColumnBreak/> writes a column break run", async () => {
    expect(await bodyXml(<ColumnBreak />)).toBe('<w:p><w:r><w:br w:type="column"/></w:r></w:p>');
  });

  test("<SimpleField> writes w:fldSimple with its instruction and cached value", async () => {
    expect(await bodyXml(<SimpleField instruction="AUTHOR" cachedValue="Ada" />)).toBe(
      '<w:p><w:fldSimple w:instr="AUTHOR"><w:r><w:t xml:space="preserve">Ada</w:t></w:r></w:fldSimple></w:p>'
    );
  });

  test("<SimpleMailMergeField> writes a MERGEFIELD whose cached text is docx.js's «Name»", async () => {
    expect(await bodyXml(<SimpleMailMergeField fieldName="Name" />)).toBe(
      '<w:p><w:fldSimple w:instr=" MERGEFIELD Name "><w:r><w:t xml:space="preserve">«Name»</w:t></w:r></w:fldSimple></w:p>'
    );
  });

  test("<SequentialIdentifier> writes a SEQ field", async () => {
    expect(await bodyXml(<SequentialIdentifier identifier="Figure" />)).toContain(
      '<w:instrText xml:space="preserve">SEQ Figure</w:instrText>'
    );
  });

  test("<PageReference> writes a PAGEREF field as a paragraph child", async () => {
    expect(await bodyXml(<PageReference bookmarkId="bm" hyperlink />)).toBe(
      '<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/>' +
        '<w:instrText xml:space="preserve">PAGEREF bm \\h</w:instrText>' +
        '<w:fldChar w:fldCharType="end"/></w:r></w:p>'
    );
  });

  test("<CheckBox checked/> writes a w14:checkbox sdt showing ☒", async () => {
    const xml = await bodyXml(<CheckBox checked />);
    expect(xml).toContain('<w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="1"/>');
    expect(xml).toContain('<w:sdtContent><w:r><w:sym w:char="2612" w:font="MS Gothic"/></w:r></w:sdtContent></w:sdt>');
  });
});

describe("run content", () => {
  const RUN_CONTENT: [string, () => ReactElement, string][] = [
    [
      "PositionalTab",
      () => <PositionalTab alignment="center" relativeTo="margin" leader="dot" />,
      '<w:ptab w:alignment="center" w:relativeTo="margin" w:leader="dot"/>',
    ],
    ["CarriageReturn", () => <CarriageReturn />, "<w:cr/>"],
    ["SoftHyphen", () => <SoftHyphen />, "<w:softHyphen/>"],
    ["NoBreakHyphen", () => <NoBreakHyphen />, "<w:noBreakHyphen/>"],
    ["DayShort", () => <DayShort />, "<w:dayShort/>"],
    ["DayLong", () => <DayLong />, "<w:dayLong/>"],
    ["MonthShort", () => <MonthShort />, "<w:monthShort/>"],
    ["MonthLong", () => <MonthLong />, "<w:monthLong/>"],
    ["YearShort", () => <YearShort />, "<w:yearShort/>"],
    ["YearLong", () => <YearLong />, "<w:yearLong/>"],
  ];

  test.each(RUN_CONTENT)("<%s/> directly in a Paragraph is written inside a run of its own", async (_, element, xml) => {
    expect(await bodyXml(element())).toBe(`<w:p><w:r>${xml}</w:r></w:p>`);
  });

  test.each(RUN_CONTENT)("<%s/> inside a TextRun is written in that run", async (_, element, xml) => {
    expect(await bodyXml(<TextRun>a{element()}b</TextRun>)).toBe(
      `<w:p><w:r><w:t xml:space="preserve">a</w:t>${xml}<w:t xml:space="preserve">b</w:t></w:r></w:p>`
    );
  });
});
