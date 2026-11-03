/** What readDocx reports about everything it could not carry over as it was.
 *
 *  - `raw`: an element kept verbatim as RawXml. `resolved`: a theme reference turned into a literal value.
 *    `dropped`: something docx.js cannot write, or that no reader reads yet. `ignored`: editing noise,
 *    counted by element name and not listed.
 *  - `part` is the zip path the element came from. `at` is the tree path of the nearest enclosing block,
 *    or null for document-level parts (styles, settings, unread parts).
 *  - The list is sorted by part, path and element, so the same file always gives the same report. */

/** Child indices from the Document root to the nearest enclosing block (Section, Header, Footer, Paragraph, Table,
 *  TableRow, TableCell, Textbox, Comment). Block positions survive canonicalize; inline positions do not (Break splits).
 *  Footnote is inline, so a diagnostic inside a footnote carries the path of the body Paragraph holding its
 *  reference, with part "word/footnotes.xml". */
export type TreePath = readonly number[];

export type LocatedDiagnostic = {
  readonly kind: "raw" | "resolved" | "dropped";
  readonly part: string;
  readonly at: TreePath | null;
  readonly element: string;
  readonly detail: string;
};

export type Diagnostic = LocatedDiagnostic | { readonly kind: "ignored"; readonly element: string; readonly count: number };

export type DiagnosticCollector = {
  report(diagnostic: LocatedDiagnostic): void;
  ignore(element: string): void;
  list(): Diagnostic[];
};

function comparePaths(a: TreePath | null, b: TreePath | null): number {
  if (a === null || b === null) return (a === null ? 0 : 1) - (b === null ? 0 : 1);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function compareLocated(a: LocatedDiagnostic, b: LocatedDiagnostic): number {
  return compareText(a.part, b.part) || comparePaths(a.at, b.at) || compareText(a.element, b.element);
}

export function createDiagnostics(): DiagnosticCollector {
  const located: LocatedDiagnostic[] = [];
  const ignored = new Map<string, number>();
  return {
    report: (diagnostic) => located.push(diagnostic),
    ignore: (element) => ignored.set(element, (ignored.get(element) ?? 0) + 1),
    list: () => [
      ...[...located].sort(compareLocated),
      ...[...ignored]
        .sort(([a], [b]) => compareText(a, b))
        .map(([element, count]) => ({ kind: "ignored" as const, element, count })),
    ],
  };
}
