import type { CodecEnv, Note } from "../ooxml/codec";
import { createDiagnostics, type DiagnosticCollector, type LocatedDiagnostic, type TreePath } from "./diagnostics";
import { createOrdinals, type Ordinals } from "./ordinals";
import { targetOfType, type OpcPackage } from "./package";
import type { XmlElement } from "../ooxml/xml";
import { clashingStyleIds } from "../ooxml/style";
import { tableStyleBorders } from "../ooxml/table";

type Report = Omit<LocatedDiagnostic, "part" | "at">;

export type ReadContext = {
  readonly pkg: OpcPackage;
  readonly env: CodecEnv;
  readonly ordinals: Ordinals;
  readonly part: string;
  readonly at: TreePath;
  report(diagnostic: Report): void;
  ignore(element: string): void;
  notes(notes: readonly Note[]): void;
  readPart(path: string): XmlElement | null;
  consume(path: string): void;
  within(part: string | null, at: TreePath): ReadContext;
};

type ReadSession = {
  readonly ctx: ReadContext;
  readonly diagnostics: DiagnosticCollector;
  readonly consumed: ReadonlySet<string>;
};

type Shared = Pick<ReadContext, "pkg" | "env" | "ordinals" | "ignore" | "readPart" | "consume"> & {
  readonly diagnostics: DiagnosticCollector;
};

function contextAt(shared: Shared, part: string, at: TreePath): ReadContext {
  const report = (diagnostic: Report) =>
    shared.diagnostics.report({ ...diagnostic, part, at: at.length === 0 ? null : at });
  return {
    pkg: shared.pkg,
    env: shared.env,
    ordinals: shared.ordinals,
    part,
    at,
    report,
    ignore: shared.ignore,
    notes(notes) {
      for (const note of notes) {
        if (note.fate === "ignored") shared.ignore(note.element);
        else report({ kind: note.fate, element: note.element, detail: note.detail });
      }
    },
    readPart: shared.readPart,
    consume: shared.consume,
    within: (nextPart, nextAt) => contextAt(shared, nextPart ?? part, nextAt),
  };
}

export function partOfType(pkg: OpcPackage, typeSuffix: string, fallback: string): string {
  return targetOfType(pkg.relsOf(pkg.mainPart), typeSuffix) ?? fallback;
}

function readerEnv(pkg: OpcPackage): CodecEnv {
  const styles = pkg.part(partOfType(pkg, "/styles", "word/styles.xml"));
  const theme = { theme: pkg.theme };
  return { ...theme, styleIds: clashingStyleIds(styles), tableStyleBorders: tableStyleBorders(styles, theme) };
}

export function createReadSession(pkg: OpcPackage): ReadSession {
  const diagnostics = createDiagnostics();
  const consumed = new Set<string>();
  const shared: Shared = {
    pkg,
    env: readerEnv(pkg),
    ordinals: createOrdinals(),
    ignore: diagnostics.ignore,
    readPart(path) {
      consumed.add(path);
      return pkg.part(path);
    },
    consume: (path) => consumed.add(path),
    diagnostics,
  };
  return { ctx: contextAt(shared, pkg.mainPart, []), diagnostics, consumed };
}
