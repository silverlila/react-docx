/** printJsx turns a canonical document tree into a .tsx module that renders the same tree (decision 12).
 *
 *  It is pure string building: no formatter, and no runtime import outside this folder. Its own layout
 *  rule is the format: a value, element or import list that fits in 100 columns stays on one line,
 *  otherwise it breaks with 2-space indentation.
 *
 *  JSX facts the printer relies on:
 *  - JSX text loses whitespace at line ends and decodes HTML entities, so text with outer spaces, other
 *    whitespace, a control character, `{`, `}`, `<`, `>` or `&` prints as a string expression.
 *  - Attribute strings decode HTML entities and cannot escape `"`, so one holding `"`, `\`, `&`, a
 *    control character or a line separator prints as an expression.
 *  - A template literal reads a raw CR as LF, so RawXml escapes CR along with `\`, `` ` `` and `${`.
 *  - A PageNumber node is the docx.PageNumber value as a run child; canonicalize turns it back. */

import type { DocumentNode, Props } from "../schema/elements";

export type Asset = { readonly path: `assets/${string}`; readonly bytes: Uint8Array };
export type GeneratedModule = { readonly source: string; readonly assets: readonly Asset[] };
export type PrintOptions = {
  /** The exported component's name. Default "DocumentComponent". */
  readonly componentName?: string;
  /** Where the components are imported from. Default "@react-docx/core". */
  readonly importFrom?: string;
};

type Bag = Readonly<Record<string, unknown>>;
type Tree = { readonly type: string; readonly props: Bag; readonly children: readonly (Tree | string)[] };
type AssetMap = ReadonlyMap<Uint8Array, Asset>;

/** Source text spliced into the output as it is. */
class Code {
  constructor(readonly text: string) {}
}

const WIDTH = 100;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const OUTER_SPACE = /^ | $/;
const NOT_JSX_TEXT = /[{}<>&\u0000-\u001f\u007f]|[^\S ]/;
const NOT_ATTRIBUTE_STRING = /["\\&\u0000-\u001f\u007f\u2028\u2029]/;
const HOISTED = ["styles", "numbering"] as const;
const IMAGE_TYPES: readonly string[] = ["jpg", "png", "gif", "bmp", "svg"];

/** docx.PageNumber's key for each of its values. */
const PAGE_NUMBER_KEYS: Readonly<Record<Props<"PageNumber">["field"], string>> = {
  CURRENT: "CURRENT",
  TOTAL_PAGES: "TOTAL_PAGES",
  TOTAL_PAGES_IN_SECTION: "TOTAL_PAGES_IN_SECTION",
  SECTION: "CURRENT_SECTION",
};
const PAGE_NUMBER_KEY: ReadonlyMap<string, string> = new Map(Object.entries(PAGE_NUMBER_KEYS));

/** Per kind, the props that print as code rather than as their value. */
const CODE_PROPS: Readonly<Record<string, (props: Bag, assets: AssetMap) => Bag>> = {
  Document: (props) => {
    const hoisted = HOISTED.filter((name) => props[name] !== undefined);
    return { ...props, ...Object.fromEntries(hoisted.map((name) => [name, new Code(name)])) };
  },
  ImageRun: (props, assets) => ({
    ...props,
    data: readAsset(props.data, assets),
    ...(isPlainObject(props.fallback)
      ? { fallback: { ...props.fallback, data: readAsset(props.fallback.data, assets) } }
      : {}),
  }),
  RawXml: (props) => {
    if (typeof props.xml !== "string") throw new TypeError("printJsx: RawXml xml must be a string in a canonical tree");
    return { ...props, xml: new Code(templateLiteral(props.xml)) };
  },
};

export function printJsx(document: DocumentNode, options: PrintOptions = {}): GeneratedModule {
  const componentName = options.componentName ?? "DocumentComponent";
  const importFrom = options.importFrom ?? "@react-docx/core";
  const root: Tree = document;
  const assets = collectAssets(root);
  const kinds = kindsUsed(root);
  const hoisted = HOISTED.flatMap((name) => (root.props[name] === undefined ? [] : [[name, root.props[name]] as const]));

  const imports = [
    ...(assets.size > 0 ? [namedImport(["readFileSync"], "node:fs")] : []),
    ...(kinds.has("PageNumber") ? [namedImport(["PageNumber"], "docx")] : []),
    namedImport([...kinds].filter((kind) => kind !== "PageNumber").sort(), importFrom),
  ];
  assertFreeName(componentName, [
    ...kinds,
    ...hoisted.map(([name]) => name),
    ...(assets.size > 0 ? ["readFileSync"] : []),
  ]);

  const consts = hoisted.map(([name, value]) => `const ${name} = ${printValue(value, 0, `const ${name} = `.length)};`);
  const component = [
    `export function ${componentName}() {`,
    "  return (",
    `    ${printElement(root, 4, assets)}`,
    "  );",
    "}",
    `export default ${componentName};`,
  ].join("\n");

  const source = [imports.join("\n"), ...consts, component].join("\n\n");
  return { source: `${source}\n`, assets: [...new Set(assets.values())] };
}

function assertFreeName(name: string, taken: readonly string[]): void {
  if (!IDENTIFIER.test(name)) throw new Error(`printJsx: componentName "${name}" is not a JavaScript identifier`);
  if (taken.includes(name)) {
    throw new Error(`printJsx: componentName "${name}" is already a name in the generated module; choose another`);
  }
}

// ——— Tree walks ———

function nodesOf(node: Tree): Tree[] {
  return [node, ...node.children.flatMap((child) => (typeof child === "string" ? [] : nodesOf(child)))];
}

function kindsUsed(root: Tree): Set<string> {
  return new Set(nodesOf(root).map((node) => node.type));
}

/** Every ImageRun's bytes (data, then fallback data) in document order, each mapped to its asset.
 *  Identical bytes share the first asset made for them. */
function collectAssets(root: Tree): AssetMap {
  const assets = new Map<Uint8Array, Asset>();
  const made: Asset[] = [];
  for (const image of nodesOf(root).filter((node) => node.type === "ImageRun")) {
    for (const { data, type } of imageSources(image.props)) {
      const known = made.find((asset) => sameBytes(asset.bytes, data));
      const asset = known ?? { path: `assets/image${made.length + 1}.${type}` as const, bytes: data };
      if (known === undefined) made.push(asset);
      assets.set(data, asset);
    }
  }
  return assets;
}

function imageSources(props: Bag): { data: Uint8Array; type: string }[] {
  const fallback = isPlainObject(props.fallback) ? [imageSource(props.fallback)] : [];
  return [imageSource(props), ...fallback];
}

function imageSource({ data, type }: Bag): { data: Uint8Array; type: string } {
  if (!(data instanceof Uint8Array)) throw new TypeError("printJsx: ImageRun data must be a Uint8Array in a canonical tree");
  if (typeof type !== "string" || !IMAGE_TYPES.includes(type)) {
    throw new TypeError(`printJsx: ImageRun type ${JSON.stringify(type)} is not one of ${IMAGE_TYPES.join(", ")}`);
  }
  return { data, type };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function readAsset(data: unknown, assets: AssetMap): Code {
  const asset = data instanceof Uint8Array ? assets.get(data) : undefined;
  if (asset === undefined) throw new Error("printJsx: an ImageRun's bytes were not collected as an asset");
  return new Code(`readFileSync(new URL(${JSON.stringify(`./${asset.path}`)}, import.meta.url))`);
}

// ——— JSX ———

function printElement(node: Tree, indent: number, assets: AssetMap): string {
  const flat = flatElement(node, assets);
  if (fits(flat, indent)) return flat;

  const inner = indent + 2;
  const { open, stacked } = openTag(node.type, attributesOf(node, assets), indent);
  if (node.children.length === 0) return stacked ? `${open}/>` : `${open} />`;
  const children = node.children.map((child) => `\n${pad(inner)}${printChild(child, inner, assets)}`).join("");
  return `${open}>${children}\n${pad(indent)}</${node.type}>`;
}

/** `<Kind attributes`, without its closing `>`: on one line when it fits or has one attribute, else one
 *  attribute per line (stacked) and ending on a line of its own. */
function openTag(type: string, attributes: [string, unknown][], indent: number): { open: string; stacked: boolean } {
  const flat = `<${type}${attributes.map(([name, value]) => ` ${attribute(name, value, flatValue)}`).join("")}`;
  if (fits(`${flat}>`, indent)) return { open: flat, stacked: false };
  if (attributes.length === 1) return { open: `<${type} ${brokenAttribute(attributes[0], indent, indent + type.length + 2)}`, stacked: false };
  const inner = indent + 2;
  const lines = attributes.map((entry) => `\n${pad(inner)}${brokenAttribute(entry, inner, inner)}`);
  return { open: `<${type}${lines.join("")}\n${pad(indent)}`, stacked: true };
}

function flatElement(node: Tree, assets: AssetMap): string {
  const open = `<${node.type}${attributesOf(node, assets).map(([name, value]) => ` ${attribute(name, value, flatValue)}`).join("")}`;
  if (node.children.length === 0) return `${open} />`;
  return `${open}>${node.children.map((child) => flatChild(child, assets)).join("")}</${node.type}>`;
}

function printChild(child: Tree | string, indent: number, assets: AssetMap): string {
  if (typeof child === "string") return text(child);
  if (child.type === "PageNumber") return pageNumber(child);
  return printElement(child, indent, assets);
}

function flatChild(child: Tree | string, assets: AssetMap): string {
  if (typeof child === "string") return text(child);
  if (child.type === "PageNumber") return pageNumber(child);
  return flatElement(child, assets);
}

function text(value: string): string {
  const plain = value !== "" && !OUTER_SPACE.test(value) && !NOT_JSX_TEXT.test(value);
  return plain ? value : `{${JSON.stringify(value)}}`;
}

function pageNumber(node: Tree): string {
  const { field } = node.props;
  const key = typeof field === "string" ? PAGE_NUMBER_KEY.get(field) : undefined;
  if (key === undefined) throw new TypeError(`printJsx: PageNumber field ${JSON.stringify(field)} is not a docx.PageNumber value`);
  return `{PageNumber.${key}}`;
}

/** The props to print, in the tree's key order, without undefined values. */
function attributesOf(node: Tree, assets: AssetMap): [string, unknown][] {
  const props = CODE_PROPS[node.type]?.(node.props, assets) ?? node.props;
  const entries = definedEntries(props);
  for (const [name] of entries) {
    if (!IDENTIFIER.test(name)) throw new Error(`printJsx: ${node.type} prop "${name}" is not a JSX attribute name`);
  }
  return entries;
}

function attribute(name: string, value: unknown, print: (value: unknown) => string): string {
  if (value === true) return name;
  if (typeof value === "string" && !NOT_ATTRIBUTE_STRING.test(value)) return `${name}="${value}"`;
  return `${name}={${print(value)}}`;
}

function brokenAttribute([name, value]: [string, unknown], indent: number, column: number): string {
  return attribute(name, value, (v) => printValue(v, indent, column + name.length + 2));
}

// ——— Values ———

/** `value` as an expression starting at `column`: on one line when it fits, else broken at `indent`. */
function printValue(value: unknown, indent: number, column: number): string {
  const flat = flatValue(value);
  if (fits(flat, column)) return flat;
  const inner = indent + 2;
  if (Array.isArray(value)) {
    return `[${value.map((item) => `\n${pad(inner)}${printValue(item, inner, inner)},`).join("")}\n${pad(indent)}]`;
  }
  if (isPlainObject(value)) {
    const entries = definedEntries(value).map(([key, item]) => {
      const prefix = `${objectKey(key)}: `;
      return `\n${pad(inner)}${prefix}${printValue(item, inner, inner + prefix.length)},`;
    });
    return `{${entries.join("")}\n${pad(indent)}}`;
  }
  return flat;
}

function flatValue(value: unknown): string {
  if (value instanceof Code) return value.text;
  if (Array.isArray(value)) return `[${value.map(flatValue).join(", ")}]`;
  if (isPlainObject(value)) {
    const entries = definedEntries(value).map(([key, item]) => `${objectKey(key)}: ${flatValue(item)}`);
    return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
  }
  return scalar(value);
}

function scalar(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof Date) return `new Date(${JSON.stringify(value.toISOString())})`;
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
    case "boolean":
    case "undefined":
      return String(value);
    default: {
      const name = typeof value === "object" ? (value.constructor?.name ?? "an object") : typeof value;
      throw new TypeError(`printJsx cannot print a ${name}: canonical props hold plain data (ImageRun bytes excepted)`);
    }
  }
}

function templateLiteral(text: string): string {
  const escaped = text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${").replace(/\r/g, "\\r");
  return `\`${escaped}\``;
}

function objectKey(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

function definedEntries(bag: Bag): [string, unknown][] {
  return Object.entries(bag).filter(([, value]) => value !== undefined);
}

function isPlainObject(value: unknown): value is Bag {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// ——— Layout ———

function namedImport(names: readonly string[], from: string): string {
  const flat = `import { ${names.join(", ")} } from ${JSON.stringify(from)};`;
  if (fits(flat, 0)) return flat;
  return `import {${names.map((name) => `\n  ${name},`).join("")}\n} from ${JSON.stringify(from)};`;
}

function fits(text: string, column: number): boolean {
  return column + text.length <= WIDTH && !text.includes("\n");
}

function pad(indent: number): string {
  return " ".repeat(indent);
}
