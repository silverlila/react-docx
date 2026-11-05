# React-DOCX

Generate Microsoft Word documents (`.docx`) using React components and JSX.

Docs, and a previewer that opens any `.docx` in your browser: **[silverlila.github.io/react-docx](https://silverlila.github.io/react-docx/)**

## Why React-DOCX?

Personally, I’ve always felt that when it comes to building documents, XML-style templating languages are the most natural fit. The docx library is excellent — it’s well-designed, feature-rich, and gives you full control over every aspect of a Word document.

However, working with it directly can feel a bit cumbersome at times, especially when managing deeply nested structures. That’s why I built React-DOCX — not to replace or reinvent docx, but to port it into a more expressive JSX syntax.

This project uses the same types, the same structure, and still depends on docx under the hood. The only difference is that you can now use React’s familiar patterns — components, hooks, and context — to build documents in a cleaner and more declarative way.

It also works the other way. It reads an existing `.docx` into the same document tree your JSX renders to, prints that tree as a React component you can keep editing, and draws it as HTML for a preview in the browser.

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
- **Read Word Files** - `readDocx` turns a `.docx` into a tree you can render back, and lists what it could not keep
- **Generate JSX** - `printJsx` turns that tree into the source of a React component
- **HTML Preview** - `DocxPreview` draws a document as pages of HTML without loading docx.js

## Installation

```bash
npm install @react-docx/core docx react
# or
yarn add @react-docx/core docx react
# or
pnpm add @react-docx/core docx react
```

`react` (18.2 or later, including 19) and `docx` (9.5 or later) are peer dependencies, so your project picks their versions. TypeScript types ship with the package.

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

## Reading, Generating and Previewing

### Reading a .docx

`readDocx` turns a `.docx` into the same tree that `renderToTree` returns. It is synchronous, takes a `Uint8Array` or `ArrayBuffer`, and needs neither Node nor docx.js, so it runs in the browser too.

```tsx
import { readFileSync, writeFileSync } from "node:fs";
import { renderToBuffer } from "@react-docx/core";
import { readDocx } from "@react-docx/core/reader";

const { document, diagnostics } = readDocx(readFileSync("resume.docx"));

writeFileSync("resume.rewritten.docx", await renderToBuffer(document));
```

Bytes that are not a Word file throw `NotADocxError`. The first write can normalise a file Word saved; reading and writing again after that gives the same document every time.

Some of what Word stores has no react-docx prop. `diagnostics` lists each such element with the part of the file it came from and, where it has one, its path in the tree:

- `dropped` - docx.js cannot write it, so it is gone after a write. A cropped image comes back uncropped, for example.
- `raw` - kept as a `RawXml` element. It is written back exactly, but cannot be edited as props.
- `resolved` - a theme reference, such as a theme colour, replaced with its literal value.
- `ignored` - editing noise, such as revision ids and spell-check marks, counted by element name.

### Generating JSX

`printJsx` prints a tree as the source of a React component. Design a template in Word, read it, and keep editing it as code: rendering the printed component gives the same tree back.

```tsx
import { componentName, printJsx } from "@react-docx/core/codegen";

const name = componentName("my resume.docx"); // "MyResume"
const { source, assets } = printJsx(document, { componentName: name });

writeFileSync(`${name}.tsx`, source);
for (const asset of assets) writeFileSync(asset.path, asset.bytes); // assets/image1.png, …
```

- Styles and numbering become constants at the top of the module, images become files under `assets/`, and the module imports only the components the document uses.
- `componentName` turns a file name into a name `printJsx` accepts. A name that would start with a digit, or that is already a component's name such as `Paragraph`, gets a `Doc` prefix.
- `importFrom` sets where the module imports the components from. It defaults to `"@react-docx/core"`.

### Previewing as HTML

`DocxPreview` draws a tree as HTML on pages of the document's page size, with its fonts, spacing, lists, tables, images, headers, footers and footnotes. It takes a tree rather than children, so render your JSX to a tree first:

```tsx
import { useMemo } from "react";
import { DocxPreview, renderToTree } from "@react-docx/core/html";

export function ResumePreview({ data }: { data: ResumeData }) {
  const tree = useMemo(() => renderToTree(<Resume data={data} />), [data]);
  return <DocxPreview document={tree} className="preview" />;
}
```

- A page ends at a page break, before a section that is not continuous, before a paragraph with `pageBreakBefore`, and where Word ended it when it last saved the file. In a browser the preview also measures each page and moves what does not fit to the next one. Rendered on a server, a page that overflows grows instead.
- Every style is inline, so it needs no stylesheet. It forwards its ref and any div props.
- Every block carries `data-docx-path`, its path in the tree, for linking your UI to a place in the document.
- Links keep only `http:`, `https:`, `mailto:` and in-document targets, because a file's links come from whoever wrote it.
- Lines and pages break where the browser's text layout puts them, so a page can end a few lines earlier or later than in Word. Fonts are the browser's: one the viewer lacks falls back to another.
- `resolveDocument` returns the pages as data, the same ones `DocxPreview` draws, for building a preview of your own.

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

### Entry Points

| Import                     | What it gives you                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `@react-docx/core`         | The components, the rendering functions, `TreeError`, `ELEMENTS`, `DEFAULT_NUMBERING`    |
| `@react-docx/core/reader`  | `readDocx`, `NotADocxError`, and the `Diagnostic` and `ReadResult` types                 |
| `@react-docx/core/codegen` | `printJsx`, `componentName`                                                              |
| `@react-docx/core/html`    | `DocxPreview`, `resolveDocument`, and `renderToTree` again so a preview needs one import |

The `/reader` and `/html` entries load no docx.js, so a browser bundle that only reads or previews a document stays small.

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

Each takes a JSX element, or a tree returned by `renderToTree` or `readDocx`.

- `renderToBuffer(source)` - Returns `Promise<Buffer>`, for files or HTTP responses in Node
- `renderToBlob(source)` - Returns `Promise<Blob>`, for downloads in the browser
- `renderToBase64(source)` - Returns `Promise<string>`, for APIs that take base64
- `renderToTree(element)` - Returns the document as plain data (`DocumentNode`), the same for every way of writing it

### Other Exports

- `TreeError` - what rendering throws when an element sits where Word does not allow it, or a prop would write a file Word cannot open. Its message names the element's place, such as `Document > Section[0] > PageBreak[0]`.
- `ELEMENTS` - every component, with its docx.js class and the children it allows.
- `DEFAULT_NUMBERING` - the `"NumberedList"` and `"BulletList"` configs that `List` uses unless the `Document`'s `numbering` sets its own. Copy it as a starting point for your own markers.

## Type Safety

All components have full TypeScript support. Props map directly to the `docx` library interfaces, so you can reference [docx documentation](https://docx.js.org/) for detailed prop options.

```tsx
import type { DocumentProps, SectionProps, ParagraphProps, TextRunProps } from "@react-docx/core";
import type { DocumentNode, Node, Kind, Props } from "@react-docx/core";
```

## Examples

See the `/examples` directory for complete examples:

- **basic.tsx** - Basic document with text formatting
- **advanced.tsx** - Tables, hyperlinks, page breaks
- **header-footer.tsx** - Headers, footers and page numbers
- **resume.tsx** - Professional resume template

Run `pnpm run examples` to write each one's `.docx` next to it.

## Contributing

Issues and pull requests are welcome. CI fails a pull request with a lint error or unformatted code, so run `pnpm run lint` and `pnpm run fmt` before you push.

```bash
pnpm install
pnpm test               # vitest
pnpm run type-check     # tsc
pnpm run lint           # oxlint
pnpm run fmt            # oxfmt, rewrites files; fmt:check only reports
pnpm run build          # tsup, writes dist/
```

Scripts for checking a change against real Word files:

- `pnpm run roundtrip <file.docx> …` - reads each file, writes it back and prints it as JSX, into `.roundtrip/<name>/` with the diagnostics. With LibreOffice's `soffice` on your PATH it also writes a PDF of the original and of the rewrite, to compare.
- `pnpm run preview <file.docx | module.tsx> [out.html]` - writes the HTML preview to `.preview/`. A `.tsx` module imports `@react-docx/core` from `dist/`, so run `pnpm run build` first.

The website, with the docs and a previewer that opens any `.docx` in the browser, is in `site/`. It runs on the library's source, so it needs no build: `cd site && pnpm install && pnpm dev`.

## License

MIT © Silvi Lila

## Acknowledgments

Built on top of the [docx](https://github.com/dolanmiu/docx) library by dolanmiu.
