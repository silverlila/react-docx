import { Document, Section, Paragraph, TextRun, List, ListItem } from "@react-docx/core";

export default function Lists() {
  return (
    <Document>
      <Section>
        <Paragraph spacing={{ after: 120 }}>
          <TextRun text="Before you ship" bold size={28} />
        </Paragraph>
        <List type="numbered">
          <ListItem>Write the template as a component</ListItem>
          <ListItem>
            Pass it real data
            <List type="bullet">
              <ListItem>from props</ListItem>
              <ListItem>or from context</ListItem>
            </List>
          </ListItem>
          <ListItem>Render it to a .docx</ListItem>
        </List>
      </Section>
    </Document>
  );
}
