/** pnpm run roundtrip <file.docx> [more.docx …]
 *
 *  Reads each file and writes it back, into .roundtrip/<name>/:
 *  - roundtrip.docx: the file read with readDocx and written with renderToBuffer;
 *  - diagnostics.json: everything kept raw, resolved or dropped;
 *  - original.pdf and roundtrip.pdf, rendered by LibreOffice when `soffice` is on PATH.
 *  It prints a summary of the diagnostics per file, and exits 1 if any file failed to read or write. */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { renderToBuffer } from "../src/index";
import { readDocx, type Diagnostic } from "../src/read/index";

const OUT = ".roundtrip";
const TOP = 10;

/** How many diagnostics of each kind; an ignored entry counts every occurrence. */
function countsByKind(diagnostics: readonly Diagnostic[]): Record<Diagnostic["kind"], number> {
  const counts = { raw: 0, resolved: 0, dropped: 0, ignored: 0 };
  for (const d of diagnostics) counts[d.kind] += d.kind === "ignored" ? d.count : 1;
  return counts;
}

/** The `TOP` most frequent elements among diagnostics of `kind`, most frequent first. */
function topElements(diagnostics: readonly Diagnostic[], kind: "dropped" | "raw"): [string, number][] {
  const counts = new Map<string, number>();
  for (const d of diagnostics) if (d.kind === kind) counts.set(d.element, (counts.get(d.element) ?? 0) + 1);
  return [...counts].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)).slice(0, TOP);
}

function summary(name: string, dir: string, diagnostics: readonly Diagnostic[]): string {
  const counts = countsByKind(diagnostics);
  const lines = [`${name} → ${dir}`, `  ${Object.entries(counts).map(([kind, n]) => `${kind} ${n}`).join(" · ")}`];
  for (const kind of ["dropped", "raw"] as const) {
    const top = topElements(diagnostics, kind);
    if (top.length === 0) continue;
    lines.push(`  top ${kind}:`, ...top.map(([element, n]) => `    ${String(n).padStart(5)}  ${element}`));
  }
  return lines.join("\n");
}

/** Whether `soffice` runs; asked once. */
function hasSoffice(): boolean {
  try {
    execFileSync("soffice", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Converts each .docx to a PDF beside it, with a LibreOffice profile of this run's own so parallel runs
 *  do not fight over one. soffice exits 0 when it cannot convert a file, so each PDF is checked. */
function toPdf(files: readonly string[], dir: string, profile: string): void {
  const flag = `-env:UserInstallation=${pathToFileURL(profile).href}`;
  execFileSync("soffice", [flag, "--headless", "--convert-to", "pdf", "--outdir", dir, ...files], { stdio: "ignore" });
  for (const file of files) {
    const pdf = join(dir, `${basename(file, extname(file))}.pdf`);
    if (!existsSync(pdf)) console.error(`  soffice wrote no ${pdf}: LibreOffice could not open ${file}`);
  }
}

async function roundtrip(file: string, profile: string | null): Promise<boolean> {
  const name = basename(file, extname(file));
  const dir = join(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    const { document, diagnostics } = readDocx(new Uint8Array(readFileSync(file)));
    writeFileSync(join(dir, "roundtrip.docx"), await renderToBuffer(document));
    writeFileSync(join(dir, "diagnostics.json"), `${JSON.stringify(diagnostics, null, 2)}\n`);
    console.log(summary(name, dir, diagnostics));
  } catch (error) {
    console.error(`${file}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return false;
  }
  if (profile !== null) {
    copyFileSync(file, join(dir, "original.docx"));
    toPdf([join(dir, "original.docx"), join(dir, "roundtrip.docx")], dir, profile);
  }
  return true;
}

async function main(files: readonly string[]): Promise<number> {
  if (files.length === 0) {
    console.error("usage: pnpm run roundtrip <file.docx> [more.docx …]");
    return 1;
  }
  const soffice = hasSoffice();
  if (!soffice) console.log("soffice is not on PATH: no PDFs are written.");
  const profile = soffice ? mkdtempSync(join(tmpdir(), "react-docx-roundtrip-soffice-")) : null;
  try {
    let ok = true;
    for (const file of files) ok = (await roundtrip(file, profile)) && ok;
    return ok ? 0 : 1;
  } finally {
    if (profile !== null) rmSync(profile, { recursive: true, force: true });
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  }
);
