/** DocxPreview: draws resolveDocument's data as React DOM.
 *
 *  - One sheet per section, at the section's page width with its margins as padding. There is no fixed
 *    height and no pagination: the default header comes first, then the body, the section's footnotes and
 *    the default footer.
 *  - Every style is inline (from css.ts), with no stylesheet and no class names, so the component needs no
 *    CSS setup in the host app.
 *  - Every block carries `data-docx-path`, its canonical tree path joined with ".".
 *  - It takes a tree, not JSX children: rendering children here would run react-docx's reconciler inside a
 *    React DOM render. Callers write `useMemo(() => renderToTree(element), [element])`.
 *  - Word's default cell margins are 0.075in left and right; its default text box insets are 0.05in top
 *    and bottom, 0.1in left and right.
 *  - Link targets come from whoever wrote the file, so only http:, https: and mailto: survive. The scheme
 *    is whatever `new URL` reports, which normalises case, spaces and tabs as a browser does.
 *  - text-indent is inherited and would shift an inline-block's own first line.
 *  - A page break's <hr> would close a <p> when the markup is parsed, so paragraphs are <div>s. */

import React, { type CSSProperties, type ReactNode } from "react";
import type { TreePath } from "../read/diagnostics";
import type { DocumentNode } from "../schema/elements";
import { borderCss, paragraphStyle, runStyle } from "./css";
import {
  resolveDocument,
  type ComputedParagraph,
  type ResolvedBlock,
  type ResolvedCell,
  type ResolvedFootnote,
  type ResolvedInline,
  type ResolvedMarker,
  type ResolvedSection,
} from "./resolve";

export type DocxPreviewProps = { readonly document: DocumentNode } & Omit<React.ComponentPropsWithoutRef<"div">, "children">;

const DEFAULT_TAB_PT = 36;
const MIN_MARKER_GAP_PT = 6;
const CELL_PADDING = "0 5.4pt";
const TEXTBOX_PADDING = "3.6pt 7.2pt";
const FOOTNOTE_RULE_WIDTH = "144pt";

const SAFE_LINK_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:", "mailto:"]);

const pt = (n: number): string => `${n}pt`;
const pathAttr = (path: TreePath): string => path.join(".");

const SHEET: CSSProperties = {
  boxSizing: "border-box",
  background: "#fff",
  color: "#000",
  margin: "0 auto 24pt",
  overflowWrap: "break-word",
  boxShadow: "0 0 0 0.5pt rgba(0, 0, 0, 0.08), 0 1pt 4pt rgba(0, 0, 0, 0.12)",
};

const VERTICAL_ALIGN: Readonly<Record<ResolvedCell["verticalAlign"], CSSProperties["verticalAlign"]>> = {
  top: "top",
  center: "middle",
  bottom: "bottom",
};

function schemeOf(href: string): string | null {
  try {
    return new URL(href).protocol;
  } catch {
    return null;
  }
}

function isSafeHref(href: string): boolean {
  if (href.startsWith("#")) return true;
  const scheme = schemeOf(href);
  return scheme !== null && SAFE_LINK_SCHEMES.has(scheme);
}

function Inline({ inline }: { readonly inline: ResolvedInline }): ReactNode {
  switch (inline.kind) {
    case "text":
      return <span style={runStyle(inline.run)}>{inline.text}</span>;
    case "tab":
      return <span style={{ display: "inline-block", width: pt(DEFAULT_TAB_PT) }} />;
    case "lineBreak":
      return <br />;
    case "pageBreak":
      return <hr data-docx-page-break="" />;
    case "columnBreak":
      return <br data-docx-column-break="" />;
    case "field":
      return (
        <span data-docx-field="" style={runStyle(inline.run)}>
          {inline.placeholder}
        </span>
      );
    case "image":
      return (
        <img
          src={inline.src}
          width={inline.widthPx}
          height={inline.heightPx}
          alt={inline.alt}
          style={{ verticalAlign: "bottom" }}
          data-docx-floating={inline.floating ? "" : undefined}
        />
      );
    case "link":
      return isSafeHref(inline.href) ? (
        <a href={inline.href}>
          <Inlines inlines={inline.inlines} />
        </a>
      ) : (
        <span>
          <Inlines inlines={inline.inlines} />
        </span>
      );
    case "anchor":
      return (
        <span id={inline.id}>
          <Inlines inlines={inline.inlines} />
        </span>
      );
    case "footnoteRef":
      return <sup style={runStyle(inline.run)}>{inline.n}</sup>;
    case "raw":
      return <span data-docx-raw={inline.element} />;
    default: {
      const exhaustive: never = inline;
      throw new Error(`DocxPreview: unknown inline ${JSON.stringify(exhaustive)}`);
    }
  }
}

function Inlines({ inlines }: { readonly inlines: readonly ResolvedInline[] }): ReactNode {
  return inlines.map((inline, i) => <Inline key={i} inline={inline} />);
}

function Marker({ marker, format }: { readonly marker: ResolvedMarker; readonly format: ComputedParagraph }): ReactNode {
  if (marker.suffix !== "tab") {
    return (
      <>
        <span data-docx-marker="" style={runStyle(marker.run)}>
          {marker.text}
        </span>
        {marker.suffix === "space" ? " " : null}
      </>
    );
  }
  const style: CSSProperties = {
    display: "inline-block",
    boxSizing: "border-box",
    minWidth: pt(Math.max(0, -format.firstLinePt)),
    paddingRight: pt(MIN_MARKER_GAP_PT),
    textIndent: 0,
    ...runStyle(marker.run),
  };
  return (
    <span data-docx-marker="" style={style}>
      {marker.text}
    </span>
  );
}

type Paragraph = Extract<ResolvedBlock, { kind: "paragraph" }>;
type Table = Extract<ResolvedBlock, { kind: "table" }>;
type Row = Table["rows"][number];

function ParagraphBlock({ block }: { readonly block: Paragraph }): ReactNode {
  const empty = block.marker === null && block.inlines.length === 0;
  return (
    <div data-docx-path={pathAttr(block.path)} style={{ ...paragraphStyle(block.format), whiteSpace: "pre-wrap" }}>
      {block.marker === null ? null : <Marker marker={block.marker} format={block.format} />}
      <Inlines inlines={block.inlines} />
      {empty ? <br /> : null}
    </div>
  );
}

function cellStyle(cell: ResolvedCell): CSSProperties {
  const { top, bottom, left, right } = cell.borders;
  return {
    padding: CELL_PADDING,
    verticalAlign: VERTICAL_ALIGN[cell.verticalAlign],
    ...(cell.widthPt === null ? {} : { width: pt(cell.widthPt) }),
    ...(cell.background === null ? {} : { backgroundColor: `#${cell.background}` }),
    ...(top === undefined ? {} : { borderTop: borderCss(top) }),
    ...(bottom === undefined ? {} : { borderBottom: borderCss(bottom) }),
    ...(left === undefined ? {} : { borderLeft: borderCss(left) }),
    ...(right === undefined ? {} : { borderRight: borderCss(right) }),
  };
}

function TableRow({ row }: { readonly row: Row }): ReactNode {
  return (
    <tr style={row.heightPt === null ? undefined : { height: pt(row.heightPt) }}>
      {row.cells.map((cell, i) => (
        <td
          key={i}
          colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
          rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
          style={cellStyle(cell)}
        >
          <Blocks blocks={cell.blocks} />
        </td>
      ))}
    </tr>
  );
}

function TableBlock({ block }: { readonly block: Table }): ReactNode {
  const firstBodyRow = block.rows.findIndex((row) => !row.isHeader);
  const headCount = firstBodyRow === -1 ? block.rows.length : firstBodyRow;
  const rows = (from: number, to?: number): ReactNode =>
    block.rows.slice(from, to).map((row, i) => <TableRow key={from + i} row={row} />);
  return (
    <table
      data-docx-path={pathAttr(block.path)}
      style={{ borderCollapse: "collapse", ...(block.widthPt === null ? {} : { width: pt(block.widthPt) }) }}
    >
      {block.columnWidthsPt.length === 0 ? null : (
        <colgroup>
          {block.columnWidthsPt.map((width, i) => (
            <col key={i} style={{ width: pt(width) }} />
          ))}
        </colgroup>
      )}
      {headCount === 0 ? null : <thead>{rows(0, headCount)}</thead>}
      {headCount === block.rows.length ? null : <tbody>{rows(headCount)}</tbody>}
    </table>
  );
}

function Block({ block }: { readonly block: ResolvedBlock }): ReactNode {
  switch (block.kind) {
    case "paragraph":
      return <ParagraphBlock block={block} />;
    case "table":
      return <TableBlock block={block} />;
    case "textbox":
      return (
        <div
          data-docx-path={pathAttr(block.path)}
          style={{
            boxSizing: "border-box",
            border: "0.75pt solid #000",
            padding: TEXTBOX_PADDING,
            ...(block.widthPt === null ? {} : { width: pt(block.widthPt) }),
            ...(block.heightPt === null ? {} : { minHeight: pt(block.heightPt) }),
          }}
        >
          <Blocks blocks={block.blocks} />
        </div>
      );
    case "raw":
      return <div data-docx-path={pathAttr(block.path)} data-docx-raw={block.element} />;
    default: {
      const exhaustive: never = block;
      throw new Error(`DocxPreview: unknown block ${JSON.stringify(exhaustive)}`);
    }
  }
}

function Blocks({ blocks }: { readonly blocks: readonly ResolvedBlock[] }): ReactNode {
  return blocks.map((block) => <Block key={pathAttr(block.path)} block={block} />);
}

function Footnotes({ notes }: { readonly notes: readonly ResolvedFootnote[] }): ReactNode {
  if (notes.length === 0) return null;
  return (
    <div data-docx-footnotes="">
      <hr style={{ width: FOOTNOTE_RULE_WIDTH, margin: "12pt 0 6pt", border: 0, borderTop: "0.5pt solid #000" }} />
      {notes.map((note) => (
        <div key={note.n} data-docx-footnote={note.n} style={{ display: "flex", gap: "3pt" }}>
          <sup>{note.n}</sup>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Blocks blocks={note.blocks} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Sheet({ section }: { readonly section: ResolvedSection }): ReactNode {
  const { top, right, bottom, left } = section.marginsPt;
  return (
    <div
      data-docx-section=""
      data-docx-path={pathAttr(section.path)}
      style={{ ...SHEET, width: pt(section.widthPt), padding: `${pt(top)} ${pt(right)} ${pt(bottom)} ${pt(left)}` }}
    >
      {section.header.length === 0 ? null : (
        <div data-docx-header="">
          <Blocks blocks={section.header} />
        </div>
      )}
      <Blocks blocks={section.body} />
      <Footnotes notes={section.footnotes} />
      {section.footer.length === 0 ? null : (
        <div data-docx-footer="">
          <Blocks blocks={section.footer} />
        </div>
      )}
    </div>
  );
}

export const DocxPreview = React.forwardRef<HTMLDivElement, DocxPreviewProps>(function DocxPreview(
  { document, ...rest },
  ref
) {
  const sections = React.useMemo(() => resolveDocument(document), [document]);
  return (
    <div ref={ref} data-docx-preview="" {...rest}>
      {sections.map((section) => (
        <Sheet key={pathAttr(section.path)} section={section} />
      ))}
    </div>
  );
});
