import { Document, Section, Paragraph, TextRun } from "@react-docx/core";

export default function Hello() {
  return (
    <Document>
      <Section>
        <Paragraph>
          <TextRun text="Hello from React." bold size={32} />
        </Paragraph>
        <Paragraph>
          <TextRun text="This paragraph is a component, and so is the document around it." />
        </Paragraph>
      </Section>
    </Document>
  );
}
