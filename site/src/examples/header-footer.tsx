import { PageNumber } from "docx";
import { Document, Section, Header, Footer, Paragraph, TextRun } from "@react-docx/core";

export default function Report() {
  return (
    <Document>
      <Section>
        <Header>
          <Paragraph alignment="right">
            <TextRun text="Acme Ltd · Annual report" color="6B7280" size={18} />
          </Paragraph>
        </Header>
        <Footer>
          <Paragraph alignment="center">
            <TextRun size={18} children={["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES]} />
          </Paragraph>
        </Footer>
        <Paragraph>
          <TextRun text="The header and footer repeat on every page of this section." />
        </Paragraph>
      </Section>
    </Document>
  );
}
