/** AC9: the reader against the writer (decision 10).
 *
 *  - react-docx output is an exact fixed point: read, write, read gives the same tree and the same XML.
 *  - Word-shaped input is stable after one write, and its first read reports exactly what it loses.
 *  - Real files in test/fixtures/real/ (gitignored, private) get the same stability check; their
 *    diagnostics are printed, not pinned. */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { renderToBuffer } from "../src/index";
import { readDocx, type Diagnostic } from "../src/read/index";
import type { DocumentNode } from "../src/schema/elements";
import { WORD_SHAPED } from "./fixtures/word-shaped";
import { CASES } from "./support/cases";
import { docxXml } from "./support/docx-xml";

const REAL = join(__dirname, "fixtures", "real");

const read = (b: Uint8Array) => readDocx(b).document;
const write = async (t: DocumentNode) => new Uint8Array(await renderToBuffer(t));

/** Each real .docx, by file name; none when the folder is absent. */
function realFiles(): { name: string; bytes: Uint8Array }[] {
  if (!existsSync(REAL)) return [];
  return readdirSync(REAL)
    .filter((name) => name.endsWith(".docx"))
    .map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(REAL, name))) }));
}

/** t2 = read(write(read(bytes))) and t3 = read(write(t2)). */
async function twoWrites(bytes: Uint8Array): Promise<{ t2: DocumentNode; t3: DocumentNode }> {
  const t2 = read(await write(read(bytes)));
  return { t2, t3: read(await write(t2)) };
}

/** What the first read of each Word-shaped fixture reports, in report order. Theme fonts in w:docDefaults
 *  resolve, but Word's empty complex-script theme font cannot; settings, latent styles and editing marks
 *  are ignored noise. */
const LOSSES: Readonly<Record<string, readonly { kind: string; element: string }[]>> = {
  resume: [
    { kind: "dropped", element: "w:tblLook" },
    { kind: "dropped", element: "w:tblLook" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "dropped", element: "w:rFonts" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "dropped", element: "w:rFonts" },
    { kind: "dropped", element: "w:rFonts" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "dropped", element: "w:rFonts" },
    { kind: "dropped", element: "w:rFonts" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "dropped", element: "w:rFonts" },
    { kind: "dropped", element: "w:rFonts" },
    { kind: "ignored", element: "_GoBack" },
    { kind: "ignored", element: "w:characterSpacingControl" },
    { kind: "ignored", element: "w:compat" },
    { kind: "ignored", element: "w:fldChar" },
    { kind: "ignored", element: "w:history" },
    { kind: "ignored", element: "w:lastRenderedPageBreak" },
    { kind: "ignored", element: "w:latentStyles" },
    { kind: "ignored", element: "w:multiLevelType" },
    { kind: "ignored", element: "w:nsid" },
    { kind: "ignored", element: "w:proofErr" },
    { kind: "ignored", element: "w:proofState" },
    { kind: "ignored", element: "w:rsids" },
    { kind: "ignored", element: "w:tmpl" },
    { kind: "ignored", element: "w:zoom" },
  ],
  formatting: [
    { kind: "dropped", element: "w14:ligatures" },
    { kind: "resolved", element: "w:color" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "dropped", element: "w:rFonts" },
    { kind: "ignored", element: "_GoBack" },
    { kind: "ignored", element: "w:characterSpacingControl" },
    { kind: "ignored", element: "w:compat" },
    { kind: "ignored", element: "w:latentStyles" },
    { kind: "ignored", element: "w:proofState" },
    { kind: "ignored", element: "w:rsids" },
    { kind: "ignored", element: "w:zoom" },
  ],
  notes: [
    { kind: "resolved", element: "w:rFonts" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "dropped", element: "w:rFonts" },
    { kind: "ignored", element: "_GoBack" },
    { kind: "ignored", element: "w:annotationRef" },
    { kind: "ignored", element: "w:characterSpacingControl" },
    { kind: "ignored", element: "w:compat" },
    { kind: "ignored", element: "w:footnote" },
    { kind: "ignored", element: "w:footnoteRef" },
    { kind: "ignored", element: "w:latentStyles" },
    { kind: "ignored", element: "w:proofState" },
    { kind: "ignored", element: "w:rStyle" },
    { kind: "ignored", element: "w:rsids" },
    { kind: "ignored", element: "w:zoom" },
  ],
  sections: [
    { kind: "resolved", element: "w:rFonts" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "dropped", element: "w:rFonts" },
    { kind: "ignored", element: "_GoBack" },
    { kind: "ignored", element: "w:characterSpacingControl" },
    { kind: "ignored", element: "w:compat" },
    { kind: "ignored", element: "w:latentStyles" },
    { kind: "ignored", element: "w:proofState" },
    { kind: "ignored", element: "w:rsids" },
    { kind: "ignored", element: "w:zoom" },
  ],
  objects: [
    { kind: "dropped", element: "word/charts/chart1.xml" },
    { kind: "dropped", element: "a:ext" },
    { kind: "dropped", element: "a:ext" },
    { kind: "dropped", element: "a:ext" },
    { kind: "dropped", element: "a:srcRect" },
    { kind: "dropped", element: "a:ext" },
    { kind: "resolved", element: "mc:AlternateContent" },
    { kind: "raw", element: "w:sdt" },
    { kind: "raw", element: "m:oMath" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "resolved", element: "w:rFonts" },
    { kind: "dropped", element: "w:rFonts" },
    { kind: "ignored", element: "_GoBack" },
    { kind: "ignored", element: "w:characterSpacingControl" },
    { kind: "ignored", element: "w:compat" },
    { kind: "ignored", element: "w:latentStyles" },
    { kind: "ignored", element: "w:proofState" },
    { kind: "ignored", element: "w:rsids" },
    { kind: "ignored", element: "w:zoom" },
  ],
};

type TreeNode = { readonly type: string; readonly props: Record<string, unknown>; readonly children: readonly (TreeNode | string)[] };

function imagesOf(node: TreeNode | string): TreeNode[] {
  if (typeof node === "string") return [];
  return [...(node.type === "ImageRun" ? [node] : []), ...node.children.flatMap(imagesOf)];
}

const fixture = (name: string): Uint8Array => {
  const found = WORD_SHAPED.find((f) => f.name === name);
  if (found === undefined) throw new Error(`no Word-shaped fixture ${name}`);
  return found.bytes;
};

const pairs = (diagnostics: readonly Diagnostic[]) => diagnostics.map(({ kind, element }) => ({ kind, element }));

describe("react-docx output is an exact fixed point", () => {
  test.each(CASES.map((c) => [c.name, c] as const))("%s", async (_name, { element }) => {
    const t1 = read(new Uint8Array(await renderToBuffer(element)));
    const t2 = read(await write(t1));
    expect(t2).toEqual(t1);
    expect(docxXml(await write(t2))).toEqual(docxXml(await write(t1)));
  });
});

describe("Word-shaped input is stable after one write", () => {
  test.each(WORD_SHAPED.map((f) => [f.name, f] as const))("%s", async (name, { bytes }) => {
    const { t2, t3 } = await twoWrites(bytes);
    expect(t3).toEqual(t2);
    expect(pairs(readDocx(bytes).diagnostics)).toEqual(LOSSES[name]);
  });
});

describe("what the round trip found in the reader", () => {
  test("a picture rotated by rot=31905, which docx.js writes back as 31904.999999999996, keeps its rotation", async () => {
    const { t3 } = await twoWrites(fixture("objects"));
    const rotations = imagesOf(t3 as TreeNode).map((image) => (image.props.transformation as { rotation?: number }).rotation);
    expect(rotations).toEqual([undefined, 0.53175, undefined, undefined]);
  });

  test("Word's no-fill picture line, <a:ln><a:noFill/></a:ln>, is not reported as a lost outline", () => {
    const { diagnostics } = readDocx(fixture("objects"));
    expect(diagnostics.filter((d) => d.element === "a:ln")).toEqual([]);
  });

  test("a picture's media part counts as read, not as an unread part", () => {
    const { diagnostics } = readDocx(fixture("objects"));
    expect(diagnostics.filter((d) => d.element === "word/media/image1.png")).toEqual([]);
  });
});

const REAL_FILES = realFiles();

/** Skipped, not empty, when there are no real files: vitest fails a suite with no tests. */
describe.skipIf(REAL_FILES.length === 0)("real files are stable after one write", () => {
  test.each(REAL_FILES.map((f) => [f.name, f] as const))("%s", async (name, { bytes }) => {
    console.info(name, JSON.stringify(pairs(readDocx(bytes).diagnostics)));
    const { t2, t3 } = await twoWrites(bytes);
    expect(t3).toEqual(t2);
  });
});

describe("writing what the reader read never fails", () => {
  const fixtures = [...WORD_SHAPED, ...REAL_FILES];
  test.each(fixtures.map((f) => [f.name, f] as const))("%s", async (_name, { bytes }) => {
    await expect(renderToBuffer(read(bytes))).resolves.toBeInstanceOf(Buffer);
  });
});
