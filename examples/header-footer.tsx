import React from "react";
import * as docx from "docx";
import {
  Document,
  Section,
  Header,
  Footer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  PageBreak,
  renderToBuffer,
} from "../src/index";
import fs from "node:fs";

const HeaderFooterExample = () => (
  <Document>
    <Section properties={{ titlePage: true }}>
      <Header>
        <Table width={{ size: 100, type: docx.WidthType.PERCENTAGE }}>
          <TableRow>
            <TableCell>
              <Paragraph>
                <TextRun text="Acme Ltd" bold={true} />
              </Paragraph>
            </TableCell>
            <TableCell>
              <Paragraph alignment={docx.AlignmentType.RIGHT}>
                <TextRun text="Quarterly report" />
              </Paragraph>
            </TableCell>
          </TableRow>
        </Table>
      </Header>
      <Header type="first">
        <Paragraph alignment={docx.AlignmentType.CENTER}>
          <TextRun text="First page header" italics={true} />
        </Paragraph>
      </Header>
      <Footer>
        <Paragraph alignment={docx.AlignmentType.CENTER}>
          <TextRun children={["Page ", docx.PageNumber.CURRENT]} />
        </Paragraph>
      </Footer>

      <Paragraph>
        <TextRun text="Page one. Its header is the first-page header." />
      </Paragraph>
      <Paragraph>
        <PageBreak />
      </Paragraph>
      <Paragraph>
        <TextRun text="Page two. Its header is the default header: a table." />
      </Paragraph>
    </Section>
  </Document>
);

async function generateHeaderFooterExample() {
  const buffer = await renderToBuffer(<HeaderFooterExample />);
  fs.writeFileSync("examples/header-footer.docx", buffer);
  console.log(`examples/header-footer.docx (${buffer.length} bytes)`);
}

generateHeaderFooterExample();
