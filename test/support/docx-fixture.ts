import { strToU8, zipSync } from "fflate";

export const NAMESPACES = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"',
  'xmlns:v="urn:schemas-microsoft-com:vml"',
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"',
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
  'xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main"',
  'xmlns:w10="urn:schemas-microsoft-com:office:word"',
].join(" ");

export const PICTURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

export type FixtureParts = {
  readonly body: string;
  readonly styles?: string;
  readonly numbering?: string;
  readonly rels?: string;
  readonly parts?: Readonly<Record<string, string>>;
  readonly media?: Readonly<Record<string, Uint8Array>>;
  readonly theme?: string;
  readonly footnotes?: string;
  readonly comments?: string;
  readonly core?: string;
};

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const RELATIONSHIPS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WORD_TYPES = "application/vnd.openxmlformats-officedocument.wordprocessingml";
const CORE_NAMESPACES = [
  'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:dcterms="http://purl.org/dc/terms/"',
].join(" ");

const WORD_PARTS = [
  { key: "styles", root: "w:styles", type: `${OFFICE_RELS}/styles`, content: `${WORD_TYPES}.styles+xml` },
  { key: "numbering", root: "w:numbering", type: `${OFFICE_RELS}/numbering`, content: `${WORD_TYPES}.numbering+xml` },
  { key: "footnotes", root: "w:footnotes", type: `${OFFICE_RELS}/footnotes`, content: `${WORD_TYPES}.footnotes+xml` },
  { key: "comments", root: "w:comments", type: `${OFFICE_RELS}/comments`, content: `${WORD_TYPES}.comments+xml` },
] as const;

const wrapped = (root: string, inside: string): string => `${DECLARATION}<${root} ${NAMESPACES}>${inside}</${root}>`;

const relationship = (id: string, type: string, target: string): string =>
  `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;

const relationships = (inside: string): string => `${DECLARATION}<Relationships xmlns="${RELATIONSHIPS}">${inside}</Relationships>`;

const override = (partName: string, contentType: string): string =>
  `<Override PartName="/${partName}" ContentType="${contentType}"/>`;

function contentTypes(overrides: readonly string[]): string {
  return `${DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/>${overrides.join("")}</Types>`;
}

export function docx(parts: FixtureParts): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const overrides = [override("word/document.xml", `${WORD_TYPES}.document.main+xml`)];
  const packageRels = [relationship("rIdFixture-document", `${OFFICE_RELS}/officeDocument`, "word/document.xml")];
  const documentRels = [parts.rels ?? ""];

  for (const { key, root, type, content } of WORD_PARTS) {
    const inside = parts[key];
    if (inside === undefined) continue;
    files[`word/${key}.xml`] = strToU8(wrapped(root, inside));
    documentRels.push(relationship(`rIdFixture-${key}`, type, `${key}.xml`));
    overrides.push(override(`word/${key}.xml`, content));
  }
  if (parts.theme !== undefined) {
    files["word/theme/theme1.xml"] = strToU8(`${DECLARATION}${parts.theme}`);
    documentRels.push(relationship("rIdFixture-theme", `${OFFICE_RELS}/theme`, "theme/theme1.xml"));
    overrides.push(override("word/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"));
  }
  if (parts.core !== undefined) {
    files["docProps/core.xml"] = strToU8(`${DECLARATION}<cp:coreProperties ${CORE_NAMESPACES}>${parts.core}</cp:coreProperties>`);
    packageRels.push(relationship("rIdFixture-core", `${RELATIONSHIPS}/metadata/core-properties`, "docProps/core.xml"));
    overrides.push(override("docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"));
  }

  files["[Content_Types].xml"] = strToU8(contentTypes(overrides));
  files["_rels/.rels"] = strToU8(relationships(packageRels.join("")));
  files["word/document.xml"] = strToU8(wrapped("w:document", `<w:body>${parts.body}</w:body>`));
  files["word/_rels/document.xml.rels"] = strToU8(relationships(documentRels.join("")));
  for (const [path, xml] of Object.entries(parts.parts ?? {})) files[path] = strToU8(xml);
  for (const [path, bytes] of Object.entries(parts.media ?? {})) files[path] = bytes;
  return zipSync(files);
}

export const part = (root: string, inside: string): string => wrapped(root, inside);
