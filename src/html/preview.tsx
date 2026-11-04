/** DocxPreview: draws resolveDocument's data as React DOM.
 *
 *  - One sheet per page (pages.ts says where pages break), at the page's size: at least as tall as the
 *    page, taller when its content overflows. The header starts at the header distance from the top and
 *    pushes the body down when it is taller than the top margin; the footer ends at the footer distance
 *    from the bottom; footnotes sit at the foot of the body, above the bottom margin.
 *  - Fields show the page's number, the page count and the section's number and page count.
 *  - A part whose column breaks are known is a grid of equal columns, broken there. Another part with
 *    columns is a CSS multi-column box, which balances its columns.
 *  - Blocks lay out in block flow (paragraph spacing is padding, so it does not collapse), so a floating
 *    picture wraps the paragraphs after the one it is anchored in, as in Word.
 *  - Every style is inline (from css.ts), with no stylesheet and no class names, so the component needs no
 *    CSS setup in the host app.
 *  - Every block carries `data-docx-path`, its canonical tree path joined with ".".
 *  - It takes a tree, not JSX children: rendering children here would run react-docx's reconciler inside a
 *    React DOM render. Callers write `useMemo(() => renderToTree(element), [element])`.
 *  - Word's default text box insets are 0.05in top and bottom, 0.1in left and right.
 *  - Link targets come from whoever wrote the file, so only http:, https: and mailto: survive. The scheme
 *    is whatever `new URL` reports, which normalises case, spaces and tabs as a browser does.
 *  - text-indent is inherited and would shift an inline-block's own first line.
 *  - A page break's <hr> would close a <p> when the markup is parsed, so paragraphs are <div>s. */

import React, { useContext, type CSSProperties, type ReactNode } from "react";
import type { TreePath } from "../read/diagnostics";
import type { DocumentNode } from "../schema/elements";
import { NO_BREAKS, measureBreaks, type MeasuredBreaks } from "./breaks";
import { borderCss, paragraphStyle, runStyle } from "./css";
import type {
  ComputedParagraph,
  FieldKind,
  PageGeometry,
  ResolvedFloat,
  ResolvedBlock,
  ResolvedCell,
  ResolvedFootnote,
  ResolvedInline,
  ResolvedMarker,
  TabStop,
} from "./model";
import { resolveDocument, type ResolvedPage, type ResolvedPart } from "./pages";
import { hasTabs, tabLayout, type TabItem } from "./tabs";

export type DocxPreviewProps = { readonly document: DocumentNode } & Omit<React.ComponentPropsWithoutRef<"div">, "children">;

const MIN_MARKER_GAP_PT = 6;
const TEXTBOX_PADDING = "3.6pt 7.2pt";
const FOOTNOTE_RULE_WIDTH = "144pt";

const SAFE_LINK_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:", "mailto:"]);

const pt = (n: number): string => `${n}pt`;
const pathAttr = (path: TreePath): string => path.join(".");

/** A page is a column of its header, body, footnotes and footer. */
const FLOW: CSSProperties = { display: "flex", flexDirection: "column" };

/** A block container: block flow, so a floating picture wraps the paragraphs after its own, and a
 *  formatting context of its own, so it holds its floats. */
const BLOCKS: CSSProperties = { display: "flow-root" };

const SHEET: CSSProperties = {
  ...FLOW,
  position: "relative",
  isolation: "isolate",
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

type PageFacts = {
  readonly number: string;
  readonly total: number;
  readonly section: number;
  readonly sectionPages: number;
  readonly geometry: PageGeometry;
};

const PageContext = React.createContext<PageFacts | null>(null);

function usePage(): PageFacts {
  const page = useContext(PageContext);
  if (page === null) throw new Error("DocxPreview: a page's content drew outside <Page>");
  return page;
}

function fieldText(field: FieldKind, placeholder: string, page: PageFacts): string {
  switch (field) {
    case "page":
      return page.number;
    case "numPages":
      return String(page.total);
    case "sectionPages":
      return String(page.sectionPages);
    case "section":
      return String(page.section);
    default:
      return placeholder;
  }
}

function Field({ inline }: { readonly inline: Extract<ResolvedInline, { kind: "field" }> }): ReactNode {
  const page = usePage();
  return (
    <span data-docx-field="" style={runStyle(inline.run)}>
      {fieldText(inline.field, inline.placeholder, page)}
    </span>
  );
}

/** A link draws as its runs do: Word colours and underlines a hyperlink through its runs' style, not the link. */
const LINK: CSSProperties = { color: "inherit", textDecoration: "none" };

const PT_PER_PX = 0.75;

function aligned(align: "left" | "center" | "right" | "top" | "bottom" | null, start: number, size: number, item: number, offset: number): number {
  if (align === "left" || align === "top") return start;
  if (align === "center") return start + (size - item) / 2;
  if (align === "right" || align === "bottom") return start + size - item;
  return start + offset;
}

/** Where a floating object goes, at `widthPt` × `heightPt`. Wrapped square, it floats to the side of the
 *  text it is nearer; wrapped top and bottom, it is a block; not wrapped, it is placed on the page. A
 *  position from the anchoring paragraph counts from where the object stands in the flow. */
function placement(float: ResolvedFloat, widthPt: number, heightPt: number, geometry: PageGeometry): CSSProperties {
  const { marginsPt } = geometry;
  const contentWidth = geometry.widthPt - marginsPt.left - marginsPt.right;
  const { horizontal: h, vertical: v, distancePt: d } = float;
  const left =
    h.from === "page"
      ? aligned(h.align, 0, geometry.widthPt, widthPt, h.offsetPt)
      : aligned(h.align, marginsPt.left, contentWidth, widthPt, h.offsetPt);
  const fromParagraph = v.from === "paragraph";
  const top = fromParagraph
    ? v.offsetPt
    : v.from === "page"
      ? aligned(v.align, 0, geometry.heightPt, heightPt, v.offsetPt)
      : aligned(v.align, marginsPt.top, geometry.heightPt - marginsPt.top - marginsPt.bottom, heightPt, v.offsetPt);
  if (float.wrap === "none" || float.behind) {
    return {
      position: "absolute",
      left: pt(left),
      zIndex: float.behind ? -1 : 1,
      ...(fromParagraph ? { marginTop: pt(top) } : { top: pt(top) }),
    };
  }
  const marginTop = pt((fromParagraph ? Math.max(0, top) : 0) + d.top);
  if (float.wrap === "topAndBottom") {
    return { display: "block", marginLeft: pt(left - marginsPt.left), marginTop, marginBottom: pt(d.bottom) };
  }
  const right = left + widthPt / 2 > marginsPt.left + contentWidth / 2;
  return right
    ? { float: "right", marginRight: pt(marginsPt.left + contentWidth - left - widthPt), marginLeft: pt(d.left), marginTop, marginBottom: pt(d.bottom) }
    : { float: "left", marginLeft: pt(left - marginsPt.left), marginRight: pt(d.right), marginTop, marginBottom: pt(d.bottom) };
}

function FloatingImage({ image, float }: { readonly image: Extract<ResolvedInline, { kind: "image" }>; readonly float: ResolvedFloat }): ReactNode {
  const page = usePage();
  return (
    <span data-docx-floating="" style={placement(float, image.widthPx * PT_PER_PX, image.heightPx * PT_PER_PX, page.geometry)}>
      <img src={image.src} width={image.widthPx} height={image.heightPx} alt={image.alt} style={{ display: "block" }} />
    </span>
  );
}

/** A text box in the flow is drawn as docx.js writes one, with Word's default line and white fill. A placed
 *  one is drawn without: Word's anchored text boxes mostly have neither, and the tree keeps neither. */
function TextboxBlock({ block, breakKey }: { readonly block: Extract<ResolvedBlock, { kind: "textbox" }> } & Keyed): ReactNode {
  const page = usePage();
  const placed = block.float !== null;
  const place = placed ? placement(block.float, block.widthPt ?? 0, block.heightPt ?? 0, page.geometry) : {};
  return (
    <div
      data-docx-path={pathAttr(block.path)}
      data-docx-key={breakKey}
      data-docx-floating={block.float === null ? undefined : ""}
      style={{
        ...BLOCKS,
        boxSizing: "border-box",
        padding: TEXTBOX_PADDING,
        ...(placed ? {} : { border: "0.75pt solid #000", background: "#fff" }),
        ...(block.widthPt === null ? {} : { width: pt(block.widthPt) }),
        ...(block.heightPt === null ? {} : { minHeight: pt(block.heightPt) }),
        ...(block.rotation === 0 ? {} : { transform: `rotate(${block.rotation}deg)` }),
        ...place,
      }}
    >
      <Blocks blocks={block.blocks} />
    </div>
  );
}

const COLUMN_BREAK: CSSProperties = { display: "block", breakAfter: "column" };

function Inline({ inline }: { readonly inline: ResolvedInline }): ReactNode {
  switch (inline.kind) {
    case "text":
      return (
        <span data-docx-text={inline.at?.[0]} data-docx-from={inline.at?.[1]} style={runStyle(inline.run)}>
          {inline.text}
        </span>
      );
    case "tab":
      return (
        <span data-docx-tab="" style={runStyle(inline.run)}>
          {"\t"}
        </span>
      );
    case "lineBreak":
      return <br />;
    case "pageBreak":
      return null;
    case "columnBreak":
      return <span data-docx-column-break="" style={COLUMN_BREAK} />;
    case "field":
      return <Field inline={inline} />;
    case "image":
      return inline.float === null ? (
        <img src={inline.src} width={inline.widthPx} height={inline.heightPx} alt={inline.alt} style={{ verticalAlign: "bottom" }} />
      ) : (
        <FloatingImage image={inline} float={inline.float} />
      );
    case "link":
      return isSafeHref(inline.href) ? (
        <a href={inline.href} style={LINK}>
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
      return (
        <sup data-docx-note={inline.n} style={runStyle(inline.run)}>
          {inline.n}
        </sup>
      );
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

const LEADER_CHARS: Readonly<Record<TabStop["leader"], string>> = {
  none: "",
  dot: ".",
  hyphen: "-",
  underscore: "_",
  heavy: "_",
  middleDot: "·",
};

const LEADER_REPEAT = 400;

function Gap({ item }: { readonly item: Extract<TabItem, { kind: "gap" }> }): ReactNode {
  const run = runStyle(item.tab.run);
  const underlined = item.leader === "none" && item.tab.run.underline !== null;
  return (
    <span
      data-docx-tab=""
      style={{
        flex: "1 1 0",
        minWidth: 0,
        contain: "inline-size",
        overflow: "hidden",
        whiteSpace: "nowrap",
        fontFamily: run.fontFamily,
        fontSize: run.fontSize,
        ...(item.leader === "heavy" ? { fontWeight: "bold" } : {}),
        ...(underlined ? { borderBottom: `0.75pt solid ${run.color ?? "currentColor"}`, alignSelf: "stretch" } : {}),
      }}
    >
      {LEADER_CHARS[item.leader].repeat(LEADER_REPEAT)}
    </span>
  );
}

/** The spans a tab stop places sit in one row as wide as the line at most, so they stay on one line:
 *  past it, their leaders give way first. Their text may wrap inside them, and a span's last line holds
 *  what follows its tab, as a table-of-contents entry's page number. */
function TabbedInlines({ block }: { readonly block: Paragraph }): ReactNode {
  const { format, marker } = block;
  const startPt = marker === null ? format.firstLinePt : format.firstLinePt < 0 ? 0 : format.firstLinePt + MIN_MARKER_GAP_PT * 3;
  const spans = tabLayout(block.inlines, { stops: format.tabStops, startPt });
  const placed = spans.filter((span) => span.widthPt !== null);
  const rest = spans.filter((span) => span.widthPt === null);
  const items = (span: (typeof spans)[number]) =>
    span.items.map((item, j) =>
      item.kind === "gap" ? (
        <Gap key={j} item={item} />
      ) : (
        <span key={j} style={span.widthPt === null ? undefined : { flex: "0 1 auto", minWidth: 0 }}>
          <Inlines inlines={item.inlines} />
        </span>
      )
    );
  return (
    <>
      {placed.length === 0 ? null : (
        <span
          style={{
            display: "inline-flex",
            alignItems: "last baseline",
            verticalAlign: "bottom",
            textIndent: 0,
            maxWidth: `calc(100% - ${pt(marker === null ? format.firstLinePt : 0)})`,
          }}
        >
          {placed.map((span, i) => (
            <span
              key={i}
              style={{
                display: "inline-flex",
                alignItems: "last baseline",
                flex: span.exact ? "0 1 auto" : "0 0 auto",
                ...(span.exact ? { width: pt(span.widthPt ?? 0), minWidth: 0 } : { minWidth: pt(span.widthPt ?? 0) }),
              }}
            >
              {items(span)}
            </span>
          ))}
        </span>
      )}
      {rest.map((span, i) => (
        <React.Fragment key={i}>{items(span)}</React.Fragment>
      ))}
    </>
  );
}

/** A body block's break key (breaks.ts), for measuring pages. */
type Keyed = { readonly breakKey?: string };

function ParagraphBlock({ block, breakKey }: { readonly block: Paragraph } & Keyed): ReactNode {
  const empty = block.marker === null && block.inlines.length === 0;
  return (
    <div
      data-docx-path={pathAttr(block.path)}
      data-docx-key={breakKey}
      data-docx-keep-next={block.format.keepNext ? "" : undefined}
      data-docx-keep-lines={block.format.keepLines ? "" : undefined}
      data-docx-widow-control={block.format.widowControl ? "" : undefined}
      style={{ ...paragraphStyle(block.format), whiteSpace: "pre-wrap", tabSize: pt(block.format.defaultTabPt) }}
    >
      {block.marker === null ? null : <Marker marker={block.marker} format={block.format} />}
      {hasTabs(block.inlines) ? <TabbedInlines block={block} /> : <Inlines inlines={block.inlines} />}
      {empty ? <br /> : null}
    </div>
  );
}

function cellStyle(cell: ResolvedCell): CSSProperties {
  const { top, bottom, left, right } = cell.borders;
  const padding = cell.paddingPt;
  return {
    paddingTop: pt(padding.top),
    paddingBottom: pt(padding.bottom),
    paddingInlineStart: pt(padding.left),
    paddingInlineEnd: pt(padding.right),
    verticalAlign: VERTICAL_ALIGN[cell.verticalAlign],
    ...(cell.widthPt === null ? {} : { width: pt(cell.widthPt) }),
    ...(cell.background === null ? {} : { backgroundColor: `#${cell.background}` }),
    ...(top === undefined ? {} : { borderTop: borderCss(top) }),
    ...(bottom === undefined ? {} : { borderBottom: borderCss(bottom) }),
    ...(left === undefined ? {} : { borderInlineStart: borderCss(left) }),
    ...(right === undefined ? {} : { borderInlineEnd: borderCss(right) }),
  };
}

/** A table's place across its flow, in its own direction: a right-to-left table starts at the right. */
const TABLE_ALIGN: Readonly<Record<"start" | "center" | "end", CSSProperties>> = {
  start: {},
  center: { marginInline: "auto" },
  end: { marginInlineStart: "auto" },
};

function TableRow({ row }: { readonly row: Row }): ReactNode {
  return (
    <tr data-docx-row="" style={row.heightPt === null ? undefined : { height: pt(row.heightPt) }}>
      {row.cells.map((cell, i) => (
        <td
          key={i}
          colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
          rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
          style={cellStyle(cell)}
        >
          <div style={BLOCKS}>
            <Blocks blocks={cell.blocks} />
          </div>
        </td>
      ))}
    </tr>
  );
}

function TableBlock({ block, breakKey }: { readonly block: Table } & Keyed): ReactNode {
  const firstBodyRow = block.rows.findIndex((row) => !row.isHeader);
  const headCount = firstBodyRow === -1 ? block.rows.length : firstBodyRow;
  const rows = (from: number, to?: number): ReactNode =>
    block.rows.slice(from, to).map((row, i) => <TableRow key={from + i} row={row} />);
  return (
    <table
      data-docx-path={pathAttr(block.path)}
      data-docx-key={breakKey}
      style={{
        ...TABLE_ALIGN[block.align],
        borderCollapse: "collapse",
        ...(block.rtl ? { direction: "rtl" } : {}),
        ...(block.fixed ? { tableLayout: "fixed" } : {}),
        ...(block.indentPt === 0 || block.align !== "start" ? {} : { marginInlineStart: pt(block.indentPt) }),
        ...(block.widthPct !== null ? { width: `${block.widthPct}%` } : block.widthPt === null ? {} : { width: pt(block.widthPt) }),
      }}
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

function Block({ block, breakKey }: { readonly block: ResolvedBlock } & Keyed): ReactNode {
  switch (block.kind) {
    case "paragraph":
      return <ParagraphBlock block={block} breakKey={breakKey} />;
    case "table":
      return <TableBlock block={block} breakKey={breakKey} />;
    case "textbox":
      return <TextboxBlock block={block} breakKey={breakKey} />;
    case "raw":
      return <div data-docx-path={pathAttr(block.path)} data-docx-key={breakKey} data-docx-raw={block.element} />;
    default: {
      const exhaustive: never = block;
      throw new Error(`DocxPreview: unknown block ${JSON.stringify(exhaustive)}`);
    }
  }
}

function Blocks({ blocks }: { readonly blocks: readonly ResolvedBlock[] }): ReactNode {
  return blocks.map((block, i) => <Block key={i} block={block} />);
}

function Footnotes({ notes }: { readonly notes: readonly ResolvedFootnote[] }): ReactNode {
  if (notes.length === 0) return null;
  return (
    <div data-docx-footnotes="">
      <hr style={{ width: FOOTNOTE_RULE_WIDTH, margin: "12pt 0 6pt", border: 0, borderTop: "0.5pt solid #000" }} />
      {notes.map((note) => (
        <div key={note.n} data-docx-footnote={note.n} style={{ display: "flex", gap: "3pt" }}>
          <sup>{note.n}</sup>
          <div style={{ ...BLOCKS, flex: 1, minWidth: 0 }}>
            <Blocks blocks={note.blocks} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Part({ part }: { readonly part: ResolvedPart }): ReactNode {
  const { columns, columnStarts } = part;
  if (columns === null) return part.blocks.map((block, i) => <Block key={i} block={block} breakKey={part.keys[i]} />);
  if (columnStarts !== null) {
    const half = columns.spacePt / 2;
    return (
      <div
        data-docx-columns={columns.count}
        style={{ display: "grid", gridTemplateColumns: `repeat(${columns.count}, minmax(0, 1fr))`, columnGap: pt(columns.spacePt) }}
      >
        {columnStarts.map((start, i) => (
          <div
            key={i}
            style={{
              ...BLOCKS,
              ...(i > 0 && columns.separate
                ? { marginLeft: pt(-half), paddingLeft: pt(half - 0.5), borderLeft: "0.5pt solid #000" }
                : {}),
            }}
          >
            <Blocks blocks={part.blocks.slice(start, columnStarts[i + 1])} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div
      data-docx-columns={columns.count}
      style={{
        columnCount: columns.count,
        columnGap: pt(columns.spacePt),
        ...(columns.separate ? { columnRule: "0.5pt solid #000" } : {}),
      }}
    >
      <Blocks blocks={part.blocks} />
    </div>
  );
}

function Page({ page, total }: { readonly page: ResolvedPage; readonly total: number }): ReactNode {
  const { right, left, header, footer } = page.marginsPt;
  const top = Math.abs(page.marginsPt.top);
  const bottom = Math.abs(page.marginsPt.bottom);
  const facts = { number: page.number, total, section: page.section, sectionPages: page.sectionPages, geometry: page };
  return (
    <PageContext.Provider value={facts}>
      <div
        data-docx-page={page.number}
        data-docx-path={pathAttr(page.path)}
        data-docx-laid-out={page.laidOut ? "" : undefined}
        style={{
          ...SHEET,
          width: pt(page.widthPt),
          minHeight: pt(page.heightPt),
          padding: `${pt(header)} ${pt(right)} ${pt(footer)} ${pt(left)}`,
        }}
      >
        <div data-docx-header="" style={{ ...BLOCKS, minHeight: pt(Math.max(0, top - header)) }}>
          <Blocks blocks={page.header} />
        </div>
        <div data-docx-body="" style={{ ...BLOCKS, flex: 1 }}>
          {page.parts.map((part, i) => (
            <Part key={i} part={part} />
          ))}
        </div>
        <Footnotes notes={page.footnotes} />
        <div data-docx-footer="" style={{ ...FLOW, justifyContent: "flex-end", minHeight: pt(Math.max(0, bottom - footer)) }}>
          <Blocks blocks={page.footer} />
        </div>
      </div>
    </PageContext.Provider>
  );
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

export const DocxPreview = React.forwardRef<HTMLDivElement, DocxPreviewProps>(function DocxPreview(
  { document, ...rest },
  ref
) {
  const [measured, setMeasured] = React.useState<{ readonly document: DocumentNode; readonly breaks: MeasuredBreaks }>({
    document,
    breaks: NO_BREAKS,
  });
  const breaks = measured.document === document ? measured.breaks : NO_BREAKS;
  const pages = React.useMemo(() => resolveDocument(document, breaks), [document, breaks]);
  const root = React.useRef<HTMLDivElement | null>(null);
  const [fontsLoaded, setFontsLoaded] = React.useState(0);
  useIsomorphicLayoutEffect(() => {
    if (root.current === null) return;
    const found = measureBreaks(root.current).filter((key) => !breaks.has(key));
    if (found.length > 0) setMeasured({ document, breaks: new Set([...breaks, ...found]) });
  }, [pages, fontsLoaded]);
  // Fonts load when the first layout asks for them, after which every measurement is stale: measure again
  // from no breaks each time a load finishes.
  React.useEffect(() => {
    const fonts = window.document.fonts;
    if (fonts === undefined) return;
    const remeasure = () => {
      setMeasured({ document, breaks: NO_BREAKS });
      setFontsLoaded((n) => n + 1);
    };
    fonts.addEventListener("loadingdone", remeasure);
    return () => fonts.removeEventListener("loadingdone", remeasure);
  }, [document]);
  const setRef = (el: HTMLDivElement | null) => {
    root.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref !== null) ref.current = el;
  };
  return (
    <div ref={setRef} data-docx-preview="" {...rest}>
      {pages.map((page, i) => (
        <Page key={i} page={page} total={pages.length} />
      ))}
    </div>
  );
});
