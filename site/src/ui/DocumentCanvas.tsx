import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DocxPreview, resolveDocument, type DocumentNode } from "@react-docx/core/html";

const PX_PER_PT = 96 / 72;
/** Room left on each side of a sheet when it is fitted to the canvas. */
const FIT_GUTTER_PX = 24;

/** The widest sheet's width in CSS pixels. */
function sheetWidthPx(document: DocumentNode): number {
  const widths = resolveDocument(document).map((section) => section.widthPt);
  return Math.max(...widths, 612) * PX_PER_PT;
}

/** DocxPreview draws each section as one sheet as tall as its content. On the site a sheet is at least one page
 *  tall, so a short document still reads as a page. Returns a stylesheet scoped to `scope`, an element id. */
function usePageHeights(document: DocumentNode, scope: string): string {
  return useMemo(
    () =>
      resolveDocument(document)
        .map(
          (section) =>
            `#${CSS.escape(scope)} [data-docx-section][data-docx-path="${section.path.join(".")}"]{min-height:${section.heightPt}pt}`,
        )
        .join("\n"),
    [document, scope],
  );
}

/** A document's sheets at a zoom: each at least one page tall, or with `pages={false}` as tall as its content. */
export function Sheets({ document, zoom, pages = true }: { document: DocumentNode; zoom: number; pages?: boolean }) {
  const scope = useId();
  const css = usePageHeights(document, scope);
  return (
    <div id={scope} className="canvas-inner" style={{ zoom }}>
      {pages ? <style>{css}</style> : null}
      <DocxPreview document={document} />
    </div>
  );
}

/** The zoom that fits the widest sheet into the element's width, never above 100%. */
export function useFitZoom(document: DocumentNode) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useMemo(() => sheetWidthPx(document), [document]);
  const [fit, setFit] = useState(1);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      // A hidden canvas measures 0 wide; keep the last fit rather than shrinking to the minimum.
      if (entry.contentRect.width === 0) return;
      setFit(Math.min(1, Math.max(0.2, (entry.contentRect.width - FIT_GUTTER_PX * 2) / width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);
  return { ref, fit };
}

/** Sheets on a grey canvas, scaled with CSS zoom so the layout, not just the pixels, shrinks. */
export function DocumentCanvas({
  document,
  zoom,
  pages,
  className,
  style,
}: {
  document: DocumentNode;
  /** A fixed zoom; fitted to the canvas width when omitted. */
  zoom?: number;
  /** false draws each sheet only as tall as its content. */
  pages?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const { ref, fit } = useFitZoom(document);
  return (
    <div ref={ref} className={["canvas", className].filter(Boolean).join(" ")} style={style}>
      <Sheets document={document} zoom={zoom ?? fit} pages={pages} />
    </div>
  );
}
