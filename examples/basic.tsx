import React from "react";
import {
  Document,
  Section,
  Paragraph,
  TextRun,
  Break,
  renderToBuffer,
} from "../src";
import fs from "node:fs";

/**
 * Basic Example
 *
 * Demonstrates fundamental react-docx features:
 * - Creating a document with sections
 * - Adding paragraphs with formatted text
 * - Using line breaks within paragraphs
 * - Applying text formatting (bold, italic, color, size)
 */
const BasicExample = () => (
  <Document>
    <Section>
      {/* Title */}
      <Paragraph spacing={{ after: 200 }}>
        <TextRun text="Welcome to React-DOCX" bold={true} size={32} />
      </Paragraph>

      {/* Introduction */}
      <Paragraph spacing={{ after: 300 }}>
        <TextRun text="This is a basic example demonstrating how to create " />
        <TextRun text="Microsoft Word documents " bold={true} />
        <TextRun text="using React components." />
      </Paragraph>

      {/* Text formatting examples */}
      <Paragraph spacing={{ after: 150 }}>
        <TextRun text="Text Formatting Examples:" bold={true} size={24} />
      </Paragraph>

      <Paragraph spacing={{ after: 100 }}>
        <TextRun text="• Bold text" bold={true} />
      </Paragraph>

      <Paragraph spacing={{ after: 100 }}>
        <TextRun text="• Italic text" italics={true} />
      </Paragraph>

      <Paragraph spacing={{ after: 100 }}>
        <TextRun text="• Colored text" color="2B6CB0" />
      </Paragraph>

      <Paragraph spacing={{ after: 100 }}>
        <TextRun text="• Large text" size={28} />
      </Paragraph>

      <Paragraph spacing={{ after: 100 }}>
        <TextRun text="• Combined: " />
        <TextRun text="bold, italic, and colored" bold={true} italics={true} color="E53E3E" />
      </Paragraph>

      {/* Line breaks */}
      <Paragraph spacing={{ after: 150, before: 200 }}>
        <TextRun text="Line Breaks:" bold={true} size={24} />
      </Paragraph>

      <Paragraph spacing={{ after: 200 }}>
        <TextRun text="First line" />
        <Break />
        <TextRun text="Second line" />
        <Break />
        <TextRun text="Third line" />
      </Paragraph>

      {/* Footer */}
      <Paragraph spacing={{ before: 300 }}>
        <TextRun
          text="Generated with React-DOCX"
          size={20}
          color="666666"
          italics={true}
        />
      </Paragraph>
    </Section>
  </Document>
);

async function generateBasicExample() {
  try {
    console.log("Generating basic example...\n");

    const buffer = await renderToBuffer(<BasicExample />);
    fs.writeFileSync("examples/basic.docx", buffer);

    console.log("✅ Basic example generated successfully!");
    console.log("   File: examples/basic.docx");
    console.log(`   Size: ${buffer.length} bytes\n`);
  } catch (error) {
    console.error("❌ Error generating document:", error);
    throw error;
  }
}

generateBasicExample();
