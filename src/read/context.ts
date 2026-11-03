/** The state every reader shares while walking one package: where it is (part and block path), where its
 *  diagnostics go, and which parts have been read.
 *
 *  - `within` gives a context for another part or block; everything else is shared.
 *  - Codec notes become diagnostics at the current part and path: `ignored` notes are counted.
 *  - The empty path is the Document itself, which is not a block, so it reports `at: null`.
 *  - `readPart` is how a reader opens a part, so the parts nobody read can be reported at the end. A reader
 *    that carries a part's bytes over without parsing it (a picture's media) marks it with `consume`. */

import type { CodecEnv, Note } from "../ooxml/codec";
import { createDiagnostics, type DiagnosticCollector, type LocatedDiagnostic, type TreePath } from "./diagnostics";
import { createOrdinals, type Ordinals } from "./ordinals";
import type { OpcPackage } from "./package";
import type { XmlElement } from "./xml";

export type Report = Omit<LocatedDiagnostic, "part" | "at">;

export type ReadContext = {
  readonly pkg: OpcPackage;
  readonly env: CodecEnv;
  readonly ordinals: Ordinals;
  /** The current part: relationships resolve against it. */
  readonly part: string;
  /** The current block path. */
  readonly at: TreePath;
  report(diagnostic: Report): void;
  ignore(element: string): void;
  notes(notes: readonly Note[]): void;
  readPart(path: string): XmlElement | null;
  consume(path: string): void;
  within(part: string | null, at: TreePath): ReadContext;
};

export type ReadSession = {
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

/** The main part's internal relationship target whose type ends with `typeSuffix` ("/styles", …), falling
 *  back to `fallback`, the path Word and docx.js use. */
export function partOfType(pkg: OpcPackage, typeSuffix: string, fallback: string): string {
  for (const rel of pkg.relsOf(pkg.mainPart).values()) {
    if (!rel.external && rel.type.endsWith(typeSuffix)) return rel.target;
  }
  return fallback;
}

/** A context at the main part with the empty path. */
export function createReadSession(pkg: OpcPackage): ReadSession {
  const diagnostics = createDiagnostics();
  const consumed = new Set<string>();
  const shared: Shared = {
    pkg,
    env: { theme: pkg.theme },
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
