/** The OPC package layer: unzips a .docx and exposes its parts, relationships, media, theme and core
 *  properties as plain values. Adapted from folio's packages/rebuild/docx-parts.ts.
 *
 *  - The main part is the target of the package relationship whose type ends with `/officeDocument`,
 *    falling back to word/document.xml.
 *  - Relationship targets are resolved against the folder of the part that owns the rels file, and a
 *    target starting with `/` is from the package root. External targets are kept verbatim.
 *  - `paths` lists the zip's file entries. Directory entries (names ending in `/`, which docx.js writes)
 *    are not parts and are left out.
 *  - The theme is found through the main part's `theme` relationship, falling back to
 *    word/theme/theme1.xml. A package without one has every font null and no colours, as docx.js writes.
 *  - Core properties come from docProps/core.xml, text verbatim. `revision` is kept only when it is a
 *    whole number, the only form docx.js can write back. */

import { strFromU8, unzipSync } from "fflate";
import { attrOf, childNamed, elementsOf, parseXml, textOf, type XmlElement } from "./xml";

export class NotADocxError extends Error {
  name = "NotADocxError";
}

export type Rel = { readonly type: string; readonly target: string; readonly external: boolean };

export type ThemeFontSet = {
  readonly latin: string | null;
  readonly eastAsia: string | null;
  readonly complex: string | null;
};

export type ThemeFonts = { readonly major: ThemeFontSet; readonly minor: ThemeFontSet };

/** Word theme colour names → 6-digit hex. Keys: dk1 lt1 dk2 lt2 accent1–6 hlink folHlink. */
export type ThemeColors = Readonly<Record<string, string>>;

export type CoreProperties = {
  readonly title?: string;
  readonly subject?: string;
  readonly creator?: string;
  readonly keywords?: string;
  readonly description?: string;
  readonly lastModifiedBy?: string;
  readonly revision?: number;
};

export type OpcPackage = {
  readonly mainPart: string;
  part(path: string): XmlElement | null;
  relsOf(partPath: string): ReadonlyMap<string, Rel>;
  media(path: string): Uint8Array | null;
  hasPart(path: string): boolean;
  readonly paths: readonly string[];
  readonly theme: { readonly fonts: ThemeFonts; readonly colors: ThemeColors };
  readonly core: CoreProperties;
};

const CONTENT_TYPES = "[Content_Types].xml";
const PACKAGE_RELS = "_rels/.rels";
const DEFAULT_MAIN_PART = "word/document.xml";
const DEFAULT_THEME = "word/theme/theme1.xml";
const CORE = "docProps/core.xml";

const CORE_TEXT = [
  ["title", "dc:title"],
  ["subject", "dc:subject"],
  ["creator", "dc:creator"],
  ["keywords", "cp:keywords"],
  ["description", "dc:description"],
  ["lastModifiedBy", "cp:lastModifiedBy"],
] as const;

const WHOLE_NUMBER = /^[0-9]+$/;

function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/") + 1);
}

function zipPath(folder: string, target: string): string {
  const from = target.startsWith("/") ? target : folder + target;
  const segments: string[] = [];
  for (const segment of from.split("/")) {
    if (segment === "..") segments.pop();
    else if (segment !== "." && segment !== "") segments.push(segment);
  }
  return segments.join("/");
}

function relsPathOf(partPath: string): string {
  const folder = folderOf(partPath);
  return `${folder}_rels/${partPath.slice(folder.length)}.rels`;
}

function readRels(root: XmlElement | null, folder: string): Map<string, Rel> {
  const rels = new Map<string, Rel>();
  for (const rel of elementsOf(root)) {
    const id = attrOf(rel, "Id");
    const target = attrOf(rel, "Target");
    if (rel.name !== "Relationship" || id === null || target === null) continue;
    const external = attrOf(rel, "TargetMode") === "External";
    rels.set(id, { type: attrOf(rel, "Type") ?? "", target: external ? target : zipPath(folder, target), external });
  }
  return rels;
}

export function targetOfType(rels: ReadonlyMap<string, Rel>, typeSuffix: string): string | null {
  for (const rel of rels.values()) if (!rel.external && rel.type.endsWith(typeSuffix)) return rel.target;
  return null;
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes);
  } catch (error) {
    throw new NotADocxError(`The bytes are not a zip archive (${error instanceof Error ? error.message : error}).`);
  }
}

function fontSetOf(font: XmlElement | null): ThemeFontSet {
  const typeface = (slot: string): string | null => attrOf(childNamed(font, slot), "typeface") || null;
  return { latin: typeface("a:latin"), eastAsia: typeface("a:ea"), complex: typeface("a:cs") };
}

function readThemeFonts(elements: XmlElement | null): ThemeFonts {
  const scheme = childNamed(elements, "a:fontScheme");
  return { major: fontSetOf(childNamed(scheme, "a:majorFont")), minor: fontSetOf(childNamed(scheme, "a:minorFont")) };
}

function colorOf(slot: XmlElement): string | null {
  return attrOf(childNamed(slot, "a:srgbClr"), "val") ?? attrOf(childNamed(slot, "a:sysClr"), "lastClr");
}

function readThemeColors(elements: XmlElement | null): ThemeColors {
  const colors: Record<string, string> = {};
  for (const slot of elementsOf(childNamed(elements, "a:clrScheme"))) {
    const hex = colorOf(slot);
    if (hex !== null) colors[slot.name.slice(slot.name.indexOf(":") + 1)] = hex;
  }
  return colors;
}

function readCore(root: XmlElement | null): CoreProperties {
  const core: { -readonly [K in keyof CoreProperties]: CoreProperties[K] } = {};
  for (const [key, name] of CORE_TEXT) {
    const el = childNamed(root, name);
    if (el !== null) core[key] = textOf(el);
  }
  const revision = childNamed(root, "cp:revision");
  if (revision !== null && WHOLE_NUMBER.test(textOf(revision))) core.revision = Number(textOf(revision));
  return core;
}

export function openPackage(bytes: Uint8Array): OpcPackage {
  const files = unzip(bytes);
  if (!Object.prototype.hasOwnProperty.call(files, CONTENT_TYPES)) throw new NotADocxError(`The zip has no ${CONTENT_TYPES}.`);

  const fileAt = (path: string): Uint8Array | null =>
    Object.prototype.hasOwnProperty.call(files, path) ? files[path] : null;
  const parsed = new Map<string, XmlElement | null>();
  const part = (path: string): XmlElement | null => {
    if (!parsed.has(path)) {
      const file = fileAt(path);
      parsed.set(path, file === null ? null : parseXml(strFromU8(file)));
    }
    return parsed.get(path) ?? null;
  };
  const relsOf = (partPath: string): ReadonlyMap<string, Rel> =>
    readRels(part(relsPathOf(partPath)), folderOf(partPath));

  const mainPart = targetOfType(readRels(part(PACKAGE_RELS), ""), "/officeDocument") ?? DEFAULT_MAIN_PART;
  if (fileAt(mainPart) === null) throw new NotADocxError(`The package has no main document part (${mainPart}).`);

  const themeElements = childNamed(part(targetOfType(relsOf(mainPart), "/theme") ?? DEFAULT_THEME), "a:themeElements");

  return {
    mainPart,
    part,
    relsOf,
    media: fileAt,
    hasPart: (path) => fileAt(path) !== null,
    paths: Object.keys(files).filter((path) => !path.endsWith("/")),
    theme: { fonts: readThemeFonts(themeElements), colors: readThemeColors(themeElements) },
    core: readCore(part(CORE)),
  };
}
