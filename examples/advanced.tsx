import React from "react";
import {
  Document,
  Section,
  Paragraph,
  TextRun,
  Break,
  Table,
  TableRow,
  TableCell,
  ExternalHyperlink,
  PageBreak,
  renderToBuffer,
} from "@react-docx/core";
import fs from "node:fs";

/**
 * Advanced Example
 *
 * Demonstrates advanced react-docx features:
 * - Document-level metadata and styles
 * - Multiple sections with different layouts
 * - Tables with custom styling
 * - Hyperlinks
 * - Page breaks
 * - Custom page margins
 * - Paragraph borders and spacing
 */
const AdvancedExample = () => (
  <Document
    title="Advanced React-DOCX Example"
    creator="React-DOCX"
    description="Demonstrating advanced features of react-docx library"
  >
    {/* First Section - Title Page */}
    <Section
      properties={{
        page: {
          margin: { top: 2880, right: 1440, bottom: 2880, left: 1440 },
        },
      }}
    >
      <Paragraph spacing={{ after: 400, before: 1000 }} alignment="center">
        <TextRun text="Advanced Features" bold={true} size={48} />
      </Paragraph>

      <Paragraph alignment="center" spacing={{ after: 200 }}>
        <TextRun text="React-DOCX Library" size={32} color="2B6CB0" />
      </Paragraph>

      <Paragraph alignment="center" spacing={{ after: 800 }}>
        <TextRun
          text="Comprehensive Feature Demonstration"
          size={24}
          italics={true}
          color="666666"
        />
      </Paragraph>

      <PageBreak />
    </Section>

    {/* Second Section - Content */}
    <Section
      properties={{
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      }}
    >
      {/* Tables */}
      <Paragraph
        spacing={{ after: 200 }}
        border={{ bottom: { style: "single", size: 10, color: "2B6CB0" } }}
      >
        <TextRun text="1. Tables" bold={true} size={32} />
      </Paragraph>

      <Paragraph spacing={{ after: 150 }}>
        <TextRun text="Tables allow you to organize data in rows and columns:" />
      </Paragraph>

      <Table
        width={{ size: 100, type: "pct" }}
        borders={{
          top: { style: "single", size: 6, color: "CCCCCC" },
          bottom: { style: "single", size: 6, color: "CCCCCC" },
          left: { style: "single", size: 6, color: "CCCCCC" },
          right: { style: "single", size: 6, color: "CCCCCC" },
          insideHorizontal: { style: "single", size: 6, color: "DDDDDD" },
          insideVertical: { style: "single", size: 6, color: "DDDDDD" },
        }}
      >
        <TableRow>
          <TableCell
            width={{ size: 3000, type: "dxa" }}
            shading={{ fill: "2B6CB0" }}
          >
            <Paragraph>
              <TextRun text="Feature" bold={true} color="FFFFFF" />
            </Paragraph>
          </TableCell>
          <TableCell
            width={{ size: 6000, type: "dxa" }}
            shading={{ fill: "2B6CB0" }}
          >
            <Paragraph>
              <TextRun text="Description" bold={true} color="FFFFFF" />
            </Paragraph>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell>
            <Paragraph>
              <TextRun text="JSX Syntax" bold={true} />
            </Paragraph>
          </TableCell>
          <TableCell>
            <Paragraph>
              <TextRun text="Write documents using familiar React components" />
            </Paragraph>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell>
            <Paragraph>
              <TextRun text="Type Safety" bold={true} />
            </Paragraph>
          </TableCell>
          <TableCell>
            <Paragraph>
              <TextRun text="Full TypeScript support with IntelliSense" />
            </Paragraph>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell>
            <Paragraph>
              <TextRun text="DOCX API" bold={true} />
            </Paragraph>
          </TableCell>
          <TableCell>
            <Paragraph>
              <TextRun text="Direct mapping to Microsoft Word features" />
            </Paragraph>
          </TableCell>
        </TableRow>
      </Table>

      {/* Hyperlinks */}
      <Paragraph
        spacing={{ after: 200, before: 400 }}
        border={{ bottom: { style: "single", size: 10, color: "2B6CB0" } }}
      >
        <TextRun text="2. Hyperlinks" bold={true} size={32} />
      </Paragraph>

      <Paragraph spacing={{ after: 150 }}>
        <TextRun text="Add clickable links to external resources:" />
      </Paragraph>

      <Paragraph spacing={{ after: 100 }}>
        <TextRun text="• Visit our " />
        <ExternalHyperlink link="https://github.com">
          <TextRun
            text="GitHub repository"
            color="2B6CB0"
            underline={{ type: "single" }}
          />
        </ExternalHyperlink>
      </Paragraph>

      <Paragraph spacing={{ after: 100 }}>
        <TextRun text="• Check out the " />
        <ExternalHyperlink link="https://docx.js.org">
          <TextRun
            text="DOCX documentation"
            color="2B6CB0"
            underline={{ type: "single" }}
          />
        </ExternalHyperlink>
      </Paragraph>

      {/* Multi-line Content */}
      <Paragraph
        spacing={{ after: 200, before: 400 }}
        border={{ bottom: { style: "single", size: 10, color: "2B6CB0" } }}
      >
        <TextRun text="3. Multi-line Content" bold={true} size={32} />
      </Paragraph>

      <Paragraph spacing={{ after: 150 }}>
        <TextRun text="Use line breaks to create multi-line content within a single paragraph:" />
      </Paragraph>

      <Paragraph spacing={{ after: 300 }} indent={{ left: 360 }}>
        <TextRun text="Company Name" bold={true} size={24} />
        <Break />
        <TextRun text="123 Main Street" />
        <Break />
        <TextRun text="San Francisco, CA 94105" />
        <Break />
        <TextRun text="contact@company.com" color="2B6CB0" />
      </Paragraph>

      {/* Footer */}
      <Paragraph spacing={{ before: 600 }} alignment="center">
        <TextRun text="—" size={32} color="CCCCCC" />
      </Paragraph>

      <Paragraph alignment="center">
        <TextRun
          text="Generated with React-DOCX"
          size={20}
          color="999999"
          italics={true}
        />
      </Paragraph>
    </Section>
  </Document>
);

async function generateAdvancedExample() {
  try {
    console.log("Generating advanced example...\n");

    const buffer = await renderToBuffer(<AdvancedExample />);
    fs.writeFileSync("examples/advanced.docx", buffer);

    console.log("✅ Advanced example generated successfully!");
    console.log("   File: examples/advanced.docx");
    console.log(`   Size: ${buffer.length} bytes\n`);
  } catch (error) {
    console.error("❌ Error generating document:", error);
    throw error;
  }
}

generateAdvancedExample();
