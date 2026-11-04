/** printJsx turns a canonical document tree into a .tsx module that renders the same tree.
 *
 *  It is pure string building: no formatter, and no runtime import outside this folder.
 *
 *  JSX facts the printer relies on:
 *  - JSX text loses whitespace at line ends and decodes HTML entities, so text with outer spaces, other
 *    whitespace, a control character, `{`, `}`, `<`, `>` or `&` prints as a string expression.
 *  - Attribute strings decode HTML entities and cannot escape `"`, so one holding `"`, `\`, `&`, a
 *    control character or a line separator prints as an expression.
 *  - A template literal reads a raw CR as LF, so RawXml escapes CR along with `\`, `` ` `` and `${`.
 *  - A PageNumber node is the docx.PageNumber value as a run child; canonicalize turns it back. */

import type { DocumentNode, Kind, Node, Props } from "../schema/elements";

export type Asset = { readonly path: `assets/${string}`; readonly bytes: Uint8Array };
export type GeneratedModule = { readonly source: string; readonly assets: readonly Asset[] };
export type PrintOptions = {
  /** The exported component's name. Default "DocumentComponent". */
  readonly componentName?: string;
  /** Where the components are imported from. Default "@react-docx/core". */
  readonly importFrom?: string;
};

type Bag = Readonly<Record<string, unknown>>;
type AssetMap = ReadonlyMap<Uint8Array, Asset>;
type ImageSource = { readonly data: Uint8Array; readonly type: string };

class Code {
  constructor(readonly text: string) {}
}

const WIDTH = 100;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const OUTER_SPACE = /^ | $/;
const NOT_JSX_TEXT = /[{}<>&\u0000-\u001f\u007f]|[^\S ]/;
const NOT_ATTRIBUTE_STRING = /["\\&\u0000-\u001f\u007f\u2028\u2029]/;
const HOISTED = ["styles", "numbering"] as const;

const PAGE_NUMBER_KEYS: Readonly<Record<Props<"PageNumber">["field"], string>> = {
  CURRENT: "CURRENT",
  TOTAL_PAGES: "TOTAL_PAGES",
  TOTAL_PAGES_IN_SECTION: "TOTAL_PAGES_IN_SECTION",
  SECTION: "CURRENT_SECTION",
};

export function printJsx(document: DocumentNode, options: PrintOptions = {}): GeneratedModule {
  const componentName = options.componentName ?? "DocumentComponent";
  const importFrom = options.importFrom ?? "@react-docx/core";
  const assets = collectAssets(document);
  const kinds = kindsUsed(document);
  const hoisted = HOISTED.flatMap((name) => {
    const value = document.props[name];
    return value === undefined ? [] : [[name, value] as const];
  });

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
    `    ${printElement(document, 4, assets)}`,
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

function nodesOf(node: Node): Node[] {
  return [node, ...node.children.flatMap((child) => (typeof child === "string" ? [] : nodesOf(child)))];
}

function kindsUsed(root: Node): Set<Kind> {
  return new Set(nodesOf(root).map((node) => node.type));
}

function collectAssets(root: Node): AssetMap {
  const assets = new Map<Uint8Array, Asset>();
  const made: Asset[] = [];
  for (const image of nodesOf(root).flatMap((node) => (node.type === "ImageRun" ? [node.props] : []))) {
    for (const { data, type } of imageSources(image)) {
      const known = made.find((asset) => sameBytes(asset.bytes, data));
      const asset = known ?? { path: `assets/image${made.length + 1}.${type}` as const, bytes: data };
      if (known === undefined) made.push(asset);
      assets.set(data, asset);
    }
  }
  return assets;
}

function imageSources(props: Props<"ImageRun">): readonly ImageSource[] {
  const fallback = fallbackOf(props);
  return fallback === undefined ? [props] : [props, fallback];
}

function fallbackOf(props: Props<"ImageRun">): (Bag & ImageSource) | undefined {
  if (!("fallback" in props) || !isPlainObject(props.fallback)) return undefined;
  const { data, type } = props.fallback;
  if (!(data instanceof Uint8Array) || typeof type !== "string") {
    throw new TypeError("printJsx: an ImageRun fallback must have Uint8Array data and a string type in a canonical tree");
  }
  return { ...props.fallback, data, type };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function readAsset(data: Uint8Array, assets: AssetMap): Code {
  const asset = assets.get(data);
  if (asset === undefined) throw new Error("printJsx: an ImageRun's bytes were not collected as an asset");
  return new Code(`readFileSync(new URL(${JSON.stringify(`./${asset.path}`)}, import.meta.url))`);
}

function printElement(node: Node, indent: number, assets: AssetMap): string {
  const flat = flatElement(node, assets);
  if (fits(flat, indent)) return flat;

  const inner = indent + 2;
  const { open, stacked } = openTag(node.type, attributesOf(node, assets), indent);
  if (node.children.length === 0) return stacked ? `${open}/>` : `${open} />`;
  const children = node.children.map((child) => `\n${pad(inner)}${printChild(child, inner, assets)}`).join("");
  return `${open}>${children}\n${pad(indent)}</${node.type}>`;
}

function openTag(type: string, attributes: [string, unknown][], indent: number): { open: string; stacked: boolean } {
  const flat = `<${type}${attributes.map(([name, value]) => ` ${attribute(name, value, flatValue)}`).join("")}`;
  if (fits(`${flat}>`, indent)) return { open: flat, stacked: false };
  if (attributes.length === 1) return { open: `<${type} ${brokenAttribute(attributes[0], indent, indent + type.length + 2)}`, stacked: false };
  const inner = indent + 2;
  const lines = attributes.map((entry) => `\n${pad(inner)}${brokenAttribute(entry, inner, inner)}`);
  return { open: `<${type}${lines.join("")}\n${pad(indent)}`, stacked: true };
}

function flatElement(node: Node, assets: AssetMap): string {
  const open = `<${node.type}${attributesOf(node, assets).map(([name, value]) => ` ${attribute(name, value, flatValue)}`).join("")}`;
  if (node.children.length === 0) return `${open} />`;
  return `${open}>${node.children.map((child) => flatChild(child, assets)).join("")}</${node.type}>`;
}

function printChild(child: Node | string, indent: number, assets: AssetMap): string {
  if (typeof child === "string") return text(child);
  if (child.type === "PageNumber") return pageNumber(child);
  return printElement(child, indent, assets);
}

function flatChild(child: Node | string, assets: AssetMap): string {
  if (typeof child === "string") return text(child);
  if (child.type === "PageNumber") return pageNumber(child);
  return flatElement(child, assets);
}

function text(value: string): string {
  const plain = value !== "" && !OUTER_SPACE.test(value) && !NOT_JSX_TEXT.test(value);
  return plain ? value : `{${JSON.stringify(value)}}`;
}

function pageNumber(node: Node<"PageNumber">): string {
  return `{PageNumber.${PAGE_NUMBER_KEYS[node.props.field]}}`;
}

function attributesOf(node: Node, assets: AssetMap): [string, unknown][] {
  const entries = definedEntries(codeProps(node, assets));
  for (const [name] of entries) {
    if (!IDENTIFIER.test(name)) throw new Error(`printJsx: ${node.type} prop "${name}" is not a JSX attribute name`);
  }
  return entries;
}

function codeProps(node: Node, assets: AssetMap): object {
  switch (node.type) {
    case "Document": {
      const hoisted = HOISTED.filter((name) => node.props[name] !== undefined);
      return { ...node.props, ...Object.fromEntries(hoisted.map((name) => [name, new Code(name)])) };
    }
    case "ImageRun": {
      const fallback = fallbackOf(node.props);
      const printed = fallback === undefined ? {} : { fallback: { ...fallback, data: readAsset(fallback.data, assets) } };
      return { ...node.props, data: readAsset(node.props.data, assets), ...printed };
    }
    case "RawXml":
      return { ...node.props, xml: new Code(templateLiteral(node.props.xml)) };
    default:
      return node.props;
  }
}

function attribute(name: string, value: unknown, print: (value: unknown) => string): string {
  if (value === true) return name;
  if (typeof value === "string" && !NOT_ATTRIBUTE_STRING.test(value)) return `${name}="${value}"`;
  return `${name}={${print(value)}}`;
}

function brokenAttribute([name, value]: [string, unknown], indent: number, column: number): string {
  return attribute(name, value, (v) => printValue(v, indent, column + name.length + 2));
}

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

function definedEntries(bag: object): [string, unknown][] {
  return Object.entries(bag).filter(([, value]) => value !== undefined);
}

function isPlainObject(value: unknown): value is Bag {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

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
