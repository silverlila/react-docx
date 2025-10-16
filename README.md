# React-DOCX

Generate Microsoft Word documents (`.docx`) using React components and JSX.

## Why React-DOCX?

Personally, I’ve always felt that when it comes to building documents, XML-style templating languages are the most natural fit. The docx library is excellent — it’s well-designed, feature-rich, and gives you full control over every aspect of a Word document.

However, working with it directly can feel a bit cumbersome at times, especially when managing deeply nested structures. That’s why I built React-DOCX — not to replace or reinvent docx, but to port it into a more expressive JSX syntax.

This project uses the same types, the same structure, and still depends on docx under the hood. The only difference is that you can now use React’s familiar patterns — components, hooks, and context — to build documents in a cleaner and more declarative way.

### Design Philosophy

1. **Direct Mapping** - Props map directly to DOCX API, no abstraction layers
2. **React Patterns** - Full support for Context, hooks, and composition
3. **TypeScript First** - Complete type safety out of the box
4. **Zero Config** - No build configuration needed

## Features

- **Write DOCX with JSX** - Use familiar React syntax to create Word documents
- **Full TypeScript Support** - Complete type safety with IntelliSense
- **Direct DOCX API Mapping** - Props map directly to the `docx` library API
- **React Patterns** - Supports Context, hooks, and component composition
- **Zero Configuration** - Just import and start creating documents

## Installation

```bash
npm install @react-docx/core
# or
yarn add @react-docx/core
# or
pnpm add @react-docx/core
```

## Quick Start

```tsx
import React from "react";
import {
  Document,
  Section,
  Paragraph,
  TextRun,
  renderToBuffer,
} from "@react-docx/core";
import fs from "fs";

const MyDocument = () => (
  <Document>
    <Section>
      <Paragraph>
        <TextRun text="Hello World!" bold={true} size={28} />
      </Paragraph>
    </Section>
  </Document>
);

// Generate the document
const buffer = await renderToBuffer(<MyDocument />);
fs.writeFileSync("document.docx", buffer);
```

## Core Concepts

### Document Structure

Every document follows this hierarchy:

```tsx
<Document>
  {/* Document-level properties and metadata */}
  <Section>
    {/* Section-level properties (margins, headers, footers) */}
    <Paragraph>
      {/* Paragraph-level properties (spacing, alignment) */}
      <TextRun /> {/* Text-level properties (font, size, color) */}
    </Paragraph>
  </Section>
</Document>
```

### Document Component

The `Document` component accepts document-level properties including metadata and styles:

```tsx
<Document
  title="My Resume"
  creator="John Doe"
  description="Professional resume"
>
  <Section>{/* content */}</Section>
</Document>
```

### Section Component

Sections define page layout properties like margins, page size, headers, and footers:

```tsx
<Section
  properties={{
    page: {
      margin: {
        top: 1440, // 1 inch (in twips: 1 inch = 1440 twips)
        right: 1440,
        bottom: 1440,
        left: 1440,
      },
    },
  }}
>
  {/* content */}
</Section>
```

### Paragraph Component

Paragraphs contain text and inline elements:

```tsx
<Paragraph
  spacing={{ before: 200, after: 200 }}
  alignment="center"
  indent={{ left: 720 }}
>
  <TextRun text="Centered paragraph" />
</Paragraph>
```

### TextRun Component

TextRuns apply formatting to text:

```tsx
<TextRun
  text="Hello World"
  bold={true}
  italics={true}
  size={24} // Font size in half-points (24 = 12pt)
  color="2B6CB0" // Hex color without #
  font="Arial"
/>
```

## Advanced Features

### Line Breaks

Use `<Break />` to add line breaks within a paragraph:

```tsx
<Paragraph>
  <TextRun text="First line" />
  <Break />
  <TextRun text="Second line" />
  <Break />
  <TextRun text="Third line" />
</Paragraph>
```

### Tables

```tsx
<Table
  width={{ size: 100, type: "pct" }}
  borders={{
    top: { style: "single", size: 6, color: "CCCCCC" },
    bottom: { style: "single", size: 6, color: "CCCCCC" },
  }}
>
  <TableRow>
    <TableCell>
      <Paragraph>
        <TextRun text="Cell 1" />
      </Paragraph>
    </TableCell>
    <TableCell>
      <Paragraph>
        <TextRun text="Cell 2" />
      </Paragraph>
    </TableCell>
  </TableRow>
</Table>
```

### Hyperlinks

```tsx
<ExternalHyperlink link="https://github.com">
  <TextRun text="Visit GitHub" color="0000FF" underline={{ type: "single" }} />
</ExternalHyperlink>
```

### Page Breaks

```tsx
<PageBreak />
```

## API Reference

### Components

- `Document` - Root document component
- `Section` - Document section with page layout
- `Paragraph` - Text paragraph
- `TextRun` - Formatted text
- `Break` - Line break within paragraph
- `Table` - Table element
- `TableRow` - Table row
- `TableCell` - Table cell
- `ExternalHyperlink` - External URL link
- `InternalHyperlink` - Internal bookmark link
- `PageBreak` - Page break
- `Bookmark` - Bookmark anchor
- `Tab` - Tab character
- `ImageRun` - Embedded image
- `SymbolRun` - Special symbol
- `Math` - Mathematical equation

### Rendering Functions

- `renderToBuffer(element)` - Returns `Promise<Buffer>`
- `renderToBlob(element)` - Returns `Promise<Blob>`
- `renderToBase64(element)` - Returns `Promise<string>`

## Type Safety

All components have full TypeScript support. Props map directly to the `docx` library interfaces, so you can reference [docx documentation](https://docx.js.org/) for detailed prop options.

```tsx
import {
  DocumentProps,
  SectionProps,
  ParagraphProps,
  TextRunProps,
} from "@react-docx/core";
```

## Examples

See the `/examples` directory for complete examples:

- **basic.tsx** - Basic document with text formatting
- **advanced.tsx** - Tables, hyperlinks, page breaks
- **resume.tsx** - Professional resume template

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT © Silvi Lila

## Acknowledgments

Built on top of the [docx](https://github.com/dolanmiu/docx) library by dolanmiu.
