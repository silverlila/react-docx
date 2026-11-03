import type { ReactElement } from "react";
import {
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  PageNumber,
  ShadingType,
  WidthType,
} from "docx";
import {
  Bookmark,
  Break,
  Comment,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DEFAULT_NUMBERING,
  Document,
  ExternalHyperlink,
  Footer,
  Footnote,
  Header,
  ImageRun,
  InternalHyperlink,
  List,
  ListItem,
  Math,
  PageBreak,
  Paragraph,
  RawXml,
  Section,
  SymbolRun,
  Tab,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  Textbox,
  TextRun,
} from "../../src/index";

export type CharacterizationCase = {
  readonly name: string;
  readonly element: ReactElement;
  /** What 0.1.8 wrote wrong in this case; its snapshot pins the fix. */
  readonly fixed?: string;
};

export const PNG_1PX = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "000000" };

export const CASES: readonly CharacterizationCase[] = [
  {
    name: "paragraph-and-run-formatting",
    element: (
      <Document>
        <Section>
          <Paragraph
            alignment={AlignmentType.CENTER}
            spacing={{ before: 200, after: 120, line: 276 }}
            indent={{ left: 720, firstLine: 360 }}
          >
            <TextRun text="bold " bold />
            <TextRun text="italic " italics />
            <TextRun text="sized and colored " size={28} color="FF0000" />
            <TextRun text="font " font="Arial" />
            <TextRun text="underlined" underline={{}} />
          </Paragraph>
        </Section>
      </Document>
    ),
  },
  {
    name: "run-text-children",
    element: (
      <Document>
        <Section>
          <Paragraph>
            <TextRun bold>Hello</TextRun>
          </Paragraph>
          <Paragraph>plain string</Paragraph>
          <Paragraph>
            <TextRun text="a" />
          </Paragraph>
        </Section>
      </Document>
    ),
  },
  {
    name: "default-styles-and-heading",
    element: (
      <Document
        styles={{
          default: {
            document: { run: { font: "Arial", size: 22 } },
            heading1: { run: { size: 40, bold: true } },
          },
        }}
      >
        <Section>
          <Paragraph heading={HeadingLevel.HEADING_1}>
            <TextRun text="Heading one" />
          </Paragraph>
          <Paragraph heading={HeadingLevel.TITLE}>
            <TextRun text="Title" />
          </Paragraph>
        </Section>
      </Document>
    ),
  },
  {
    name: "page-number-children",
    element: (
      <Document>
        <Section>
          <Footer>
            <Paragraph>
              <TextRun children={["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES]} />
            </Paragraph>
          </Footer>
          <Paragraph>
            <TextRun text="body" />
          </Paragraph>
        </Section>
      </Document>
    ),
  },
  {
    name: "header-footer-types",
    element: (
      <Document>
        <Section properties={{ titlePage: true }}>
          <Header>
            <Paragraph>
              <TextRun text="default header" />
            </Paragraph>
          </Header>
          <Header type="first">
            <Paragraph>
              <TextRun text="first-page header" />
            </Paragraph>
          </Header>
          <Footer>
            <Paragraph>
              <TextRun text="default footer" />
            </Paragraph>
          </Footer>
          <Paragraph>
            <TextRun text="body" />
          </Paragraph>
        </Section>
      </Document>
    ),
  },
  {
    name: "tab-break-pagebreak",
    element: (
      <Document>
        <Section>
          <Paragraph>
            <TextRun text="before tab" />
            <Tab />
            <TextRun text="after tab" />
            <Break />
            <TextRun text="after break" />
          </Paragraph>
          <Paragraph>
            <PageBreak />
          </Paragraph>
        </Section>
      </Document>
    ),
  },
  {
    name: "hyperlinks-and-bookmark",
    element: (
      <Document>
        <Section>
          <Paragraph>
            <ExternalHyperlink link="https://example.com">
              <TextRun text="site" />
            </ExternalHyperlink>
          </Paragraph>
          <Paragraph>
            <Bookmark id="top">
              <TextRun text="bookmarked" />
            </Bookmark>
          </Paragraph>
          <Paragraph>
            <InternalHyperlink anchor="top">
              <TextRun text="back to top" />
            </InternalHyperlink>
          </Paragraph>
        </Section>
      </Document>
    ),
  },
  {
    name: "image",
    element: (
      <Document>
        <Section>
          <Paragraph>
            <ImageRun type="png" data={PNG_1PX} transformation={{ width: 10, height: 10 }} />
          </Paragraph>
        </Section>
      </Document>
    ),
  },
  {
    name: "table",
    element: (
      <Document>
        <Section>
          <Table width={{ size: 4000, type: WidthType.DXA }} columnWidths={[2000, 2000]}>
            <TableRow tableHeader>
              <TableCell shading={{ type: ShadingType.CLEAR, fill: "D9D9D9", color: "auto" }}>
                <Paragraph>
                  <TextRun text="shaded" />
                </Paragraph>
              </TableCell>
              <TableCell
                borders={{
                  top: CELL_BORDER,
                  bottom: CELL_BORDER,
                  left: CELL_BORDER,
                  right: CELL_BORDER,
                }}
              >
                <Paragraph>
                  <TextRun text="bordered" />
                </Paragraph>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell columnSpan={2}>
                <Paragraph>
                  <TextRun text="spans two columns" />
                </Paragraph>
              </TableCell>
            </TableRow>
          </Table>
        </Section>
      </Document>
    ),
  },
  {
    name: "multi-section",
    element: (
      <Document>
        <Section properties={{ page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } }}>
          <Paragraph>
            <TextRun text="narrow margins" />
          </Paragraph>
        </Section>
        <Section properties={{ page: { margin: { top: 1440, right: 1800, bottom: 1440, left: 1800 } } }}>
          <Paragraph>
            <TextRun text="wide margins" />
          </Paragraph>
        </Section>
      </Document>
    ),
  },
  {
    name: "list-item-outside-list",
    element: (
      <Document>
        <Section>
          <ListItem>
            <TextRun text="plain" />
          </ListItem>
        </Section>
      </Document>
    ),
  },
  {
    name: "bug-tab-in-run",
    fixed: "a w:r is nested inside a w:r",
    element: (
      <Document>
        <Section>
          <Paragraph>
            <TextRun>
              a<Tab />b
            </TextRun>
          </Paragraph>
        </Section>
      </Document>
    ),
  },
  {
    name: "bug-math-text",
    fixed: "writes an empty <m:oMath/>; the text is ignored",
    element: (
      <Document>
        <Section>
          <Paragraph>
            <Math text="x+1" />
          </Paragraph>
        </Section>
      </Document>
    ),
  },
  {
    name: "bug-symbolrun-props",
    fixed: "only char reaches docx.js; the font becomes Wingdings and bold is lost",
    element: (
      <Document>
        <Section>
          <Paragraph>
            <SymbolRun char="F071" symbolfont="Symbol" bold />
          </Paragraph>
        </Section>
      </Document>
    ),
  },
  {
    name: "bug-lists",
    fixed: "both numbered lists share one w:numId; level 1 is undefined in DEFAULT_NUMBERING",
    element: (
      <Document numbering={DEFAULT_NUMBERING as any}>
        <Section>
          <List type="numbered">
            <ListItem text="first list, item one" />
            <ListItem text="first list, item two" />
          </List>
          <List type="numbered">
            <ListItem text="second list, item one" />
          </List>
          <List type="numbered">
            <ListItem text="level zero item" />
            <List type="numbered">
              <ListItem text="level one item" />
            </List>
          </List>
          <List type="bullet">
            <ListItem text="bullet item" />
          </List>
        </Section>
      </Document>
    ),
  },
  {
    name: "bug-heading-and-style",
    fixed: "two w:pStyle elements in one paragraph",
    element: (
      <Document>
        <Section>
          <Paragraph heading={HeadingLevel.HEADING_1} style="Heading1">
            <TextRun text="heading" />
          </Paragraph>
        </Section>
      </Document>
    ),
  },
  {
    name: "bug-duplicate-style-id",
    fixed: "styles.xml defines Heading1 twice",
    element: (
      <Document
        styles={{
          paragraphStyles: [
            {
              id: "Heading1",
              name: "Heading 1",
              basedOn: "Normal",
              next: "Normal",
              run: { color: "FF0000" },
            },
          ],
        }}
      >
        <Section>
          <Paragraph heading={HeadingLevel.HEADING_1}>
            <TextRun text="red heading" />
          </Paragraph>
        </Section>
      </Document>
    ),
  },
  {
    name: "raw-xml",
    element: (
      <Document
        styles={{
          importedStyles: ['<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>'],
        }}
      >
        <Section>
          <RawXml xml="<w:sdt><w:sdtContent><w:p><w:r><w:t>in sdt</w:t></w:r></w:p></w:sdtContent></w:sdt>" />
          <Paragraph>
            <RawXml xml='<w:r><w:t xml:space="preserve"> sp a </w:t></w:r>' />
            <TextRun>
              date:
              <RawXml xml='<w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> DATE </w:instrText><w:fldChar w:fldCharType="end"/>' />
            </TextRun>
          </Paragraph>
        </Section>
      </Document>
    ),
  },
  {
    name: "notes-and-blocks",
    element: (
      <Document features={{ updateFields: true }}>
        <Comment id={0} author="Ada" initials="AL" date={new Date("2026-01-01T00:00:00Z")}>
          Check this claim
        </Comment>
        <Section>
          <TableOfContents alias="Contents" headingStyleRange="1-3" hyperlink />
          <Paragraph>
            <CommentRangeStart id={0} />
            <TextRun>Claim</TextRun>
            <CommentRangeEnd id={0} />
            <CommentReference id={0} />
            <Footnote>Source: 2026 report</Footnote>
          </Paragraph>
          <Textbox style={{ width: "200pt", height: "50pt" }}>
            <Paragraph>in box</Paragraph>
          </Textbox>
        </Section>
      </Document>
    ),
  },
];
