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
import { Document, Section, Paragraph, TextRun, renderToBuffer } from "@react-docx/core";
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
<Document title="My Resume" creator="John Doe" description="Professional resume">
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
<Paragraph spacing={{ before: 200, after: 200 }} alignment="center" indent={{ left: 720 }}>
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

### Lists

A `<List>` becomes numbered paragraphs. Nest a `<List>` inside a `<ListItem>` for a deeper level:

```tsx
<List type="numbered">
  <ListItem>First</ListItem>
  <ListItem>
    Second
    <List type="bullet">
      <ListItem>A point under the second</ListItem>
    </List>
  </ListItem>
</List>
```

- `type` is `"bullet"` (the default) or `"numbered"`. Each `<List>` numbers from the start.
- A list nests at most 9 deep, Word's level count, and must start with a `<ListItem>`.
- To change the markers, give the `Document` a `numbering` config for the reference `"NumberedList"` or `"BulletList"`, in docx.js's format, with a level for each depth your lists reach. A list nested under a list of the other type numbers from the level of its depth, so a marker such as `"%1.%2."` that shows an enclosing level's number cannot be used there.

### Hyperlinks

```tsx
<ExternalHyperlink link="https://github.com">
  <TextRun text="Visit GitHub" color="0000FF" underline={{ type: "single" }} />
</ExternalHyperlink>
```

### Page Breaks

A page break is part of a paragraph, as it is in Word:

```tsx
<Paragraph>
  <PageBreak />
</Paragraph>
```

### Headers and Footers

Put `<Header>` and `<Footer>` directly inside a `<Section>`. They take the same children as a section: paragraphs, tables, lists, images.

```tsx
<Section properties={{ titlePage: true }}>
  <Header>
    <Table width={{ size: 100, type: "pct" }}>
      <TableRow>
        <TableCell>
          <Paragraph>
            <TextRun text="Acme Ltd" />
          </Paragraph>
        </TableCell>
        <TableCell>
          <Paragraph>
            <TextRun text="Report" />
          </Paragraph>
        </TableCell>
      </TableRow>
    </Table>
  </Header>
  <Header type="first">
    <Paragraph>
      <TextRun text="Only on page one" />
    </Paragraph>
  </Header>
  <Footer>
    <Paragraph>
      <TextRun children={["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES]} />
    </Paragraph>
  </Footer>
  <Paragraph>
    <TextRun text="Body" />
  </Paragraph>
</Section>
```

`PageNumber` comes from `docx`. The text children of a `TextRun` go to docx.js as its `children`, so a `PageNumber` value becomes a Word field and any other string becomes text.

- `type` is `"default"`, `"first"` or `"even"`. It defaults to `"default"`.
- A `"first"` header shows only when the section sets `properties.titlePage`. An `"even"` header shows only when the document sets `evenAndOddHeaderAndFooters`.
- Two headers, or two footers, of the same type in one section throw.
- A `Header` or `Footer` anywhere except directly inside a `Section` throws.

## Upgrading from 0.1

- **Versions.** React 18.2 or later (including 19) and docx 9.5 or later are required. React 16 and 17 and docx 8 are no longer supported.
- **Placement.** Every element must sit where Word allows it, or the render throws a `TreeError` that names its place in the document. Most often this means inline elements (`TextRun`, `PageBreak`, `Tab`, `Break`, `Bookmark`, `ImageRun`, hyperlinks, `Math`) must be inside a `<Paragraph>`, not directly in a `Section`, `Header`, `Footer` or `TableCell`:

  ```
  Document > Section[0] > PageBreak[0]: <PageBreak> is not allowed in <Section>
  ```

- **Headers and footers.** `Section`'s `headers` and `footers` props are removed. Use `<Header>` and `<Footer>` children.
- **Footnotes and comments.** `Document`'s `footnotes` and `comments` props are removed. Put a `<Footnote>` in a paragraph where its number goes, and `<Comment>` elements directly in the `Document`.
- **Checked props.** A prop value that docx.js would write into a file Word cannot open throws a `TreeError`: a `SymbolRun` `char` that is not four hex digits (such as `"F071"`), an `ImageRun` `type` other than jpg, png, gif, bmp or svg, an svg `ImageRun` without a raster `fallback`, and a `Textbox` `style` value of the wrong kind, such as a length that is not a CSS length (`".5in"` is one, `"1e2pt"` is not).
- **Styles.** `Document`'s `externalStyles` and `styles.initialStyles` are removed. `styles.importedStyles` takes XML strings of `<w:style>` elements instead of docx.js objects.
- **Lists.** `List`'s `level` prop is removed: nest a `<List>` in a `<List>` or a `<ListItem>` instead. Each `<List>` now numbers from 1, where before every numbered list continued the previous one, and a nested list keeps its own `type`.

## API Reference

### Components

Each component takes the options of its docx.js counterpart as props: the class of the same name, or for `Section` and `Footnote`, docx.js's section and footnote options. `List` and `ListItem` become numbered paragraphs, and `RawXml` is XML you write.

- **Structure:** `Document`, `Section`, `Header`, `Footer`
- **Blocks:** `Paragraph`, `Table`, `TableRow`, `TableCell`, `List`, `ListItem`, `TableOfContents`, `Textbox`
- **Runs:** `TextRun`, `ImageRun`, `SymbolRun`, `Math`, `MathRun`
- **Links and anchors:** `ExternalHyperlink`, `InternalHyperlink`, `Bookmark`, `PageReference`
- **Breaks and spacing:** `Break`, `PageBreak`, `ColumnBreak`, `Tab`, `PositionalTab`, `CarriageReturn`, `SoftHyphen`, `NoBreakHyphen`
- **Notes and comments:** `Footnote`, `Comment`, `CommentRangeStart`, `CommentRangeEnd`, `CommentReference`
- **Tracked changes:** `InsertedTextRun`, `DeletedTextRun`
- **Fields:** `SimpleField`, `SimpleMailMergeField`, `SequentialIdentifier`, `DayShort`, `DayLong`, `MonthShort`, `MonthLong`, `YearShort`, `YearLong`, and `PageNumber` values from `docx` as `TextRun` children
- **Form controls:** `CheckBox`
- **Anything else:** `RawXml`, whose `xml` prop is WordprocessingML written where the element stands

### Rendering Functions

Each takes a JSX element, or a tree returned by `renderToTree`.

- `renderToBuffer(source)` - Returns `Promise<Buffer>`
- `renderToBlob(source)` - Returns `Promise<Blob>`
- `renderToBase64(source)` - Returns `Promise<string>`
- `renderToTree(element)` - Returns the document as plain data, the same for every way of writing it

## Type Safety

All components have full TypeScript support. Props map directly to the `docx` library interfaces, so you can reference [docx documentation](https://docx.js.org/) for detailed prop options.

```tsx
import { DocumentProps, SectionProps, ParagraphProps, TextRunProps } from "@react-docx/core";
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
