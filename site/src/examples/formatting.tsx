import { Document, Section, Paragraph, TextRun, ExternalHyperlink } from "@react-docx/core";

export default function Formatting() {
  return (
    <Document>
      <Section>
        <Paragraph alignment="center" spacing={{ after: 240 }}>
          <TextRun text="Quarterly letter" font="Georgia" size={36} color="1F3864" />
        </Paragraph>
        <Paragraph spacing={{ after: 120 }}>
          <TextRun text="Sizes are half-points, so " />
          <TextRun text="size={24}" font="Courier New" />
          <TextRun text=" is 12pt. Colours are hex without the #: " />
          <TextRun text="this is C00000" color="C00000" bold />
          <TextRun text="." />
        </Paragraph>
        <Paragraph indent={{ left: 720 }}>
          <TextRun text="Indented half an inch (720 twips), in " />
          <TextRun text="italics" italics />
          <TextRun text=", with a " />
          <ExternalHyperlink link="https://docx.js.org">
            <TextRun text="link to docx.js" color="2F5BD3" underline={{ type: "single" }} />
          </ExternalHyperlink>
          <TextRun text="." />
        </Paragraph>
      </Section>
    </Document>
  );
}
