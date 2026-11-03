/** pnpm run check:bundles (AC14): proves requirement 8 on the built dist/.
 *
 *  For each entry and format, it follows relative imports (tsup's shared ./chunk-*.mjs) transitively and
 *  collects the bare package specifiers the bundle loads at runtime. `import`/`export … from`, dynamic
 *  `import()` and `require()` are all followed in both formats, so a CommonJS shim inside an ES module
 *  counts too. It prints each entry's set, and exits 1 with the import chain of every forbidden package. */

import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const FORMATS = [".mjs", ".js"];

/** The packages each entry must never load. "*" forbids every package. */
const FORBIDDEN = {
  index: ["fflate", "htmlparser2", "domhandler"],
  reader: ["docx", "xml-js"],
  html: ["docx", "fflate", "xml-js"],
  codegen: "*",
};

/** Why a forbidden package matters, where the generic message would not say. */
const NOTES = {
  "codegen react": "src/codegen imports react for types only, so it should vanish from the bundle",
};

const SPECIFIERS = [
  /(?:^|[\s;}])(?:import|export)\s*(?:[\w*{}\s,$]*?\s*from\s*)?["']([^"']+)["']/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
];

/** `react/jsx-runtime` → `react`; `@scope/pkg/sub` → `@scope/pkg`. */
function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function specifiersIn(file) {
  const code = readFileSync(file, "utf8");
  return [...new Set(SPECIFIERS.flatMap((pattern) => [...code.matchAll(pattern)].map((match) => match[1])))];
}

/** Every bare specifier `entry` loads, each with the chain of files that leads to it. */
function bareImports(entry) {
  const parents = new Map([[entry, null]]);
  const bare = new Map();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift();
    for (const specifier of specifiersIn(file)) {
      if (specifier.startsWith(".")) {
        const target = resolve(dirname(file), specifier);
        if (!existsSync(target)) throw new Error(`${relative(DIST, file)} imports ${specifier}, which does not exist`);
        if (!parents.has(target)) {
          parents.set(target, file);
          queue.push(target);
        }
      } else if (!bare.has(specifier)) {
        bare.set(specifier, chainTo(file, parents));
      }
    }
  }
  return bare;
}

function chainTo(file, parents) {
  const chain = [];
  for (let at = file; at !== null; at = parents.get(at)) chain.unshift(relative(DIST, at));
  return chain;
}

function forbids(entry, pkg) {
  const forbidden = FORBIDDEN[entry];
  return forbidden === "*" || forbidden.includes(pkg);
}

let failures = 0;
for (const entry of Object.keys(FORBIDDEN)) {
  for (const format of FORMATS) {
    const file = resolve(DIST, `${entry}${format}`);
    if (!existsSync(file)) {
      console.error(`dist/${entry}${format} is missing: run pnpm run build`);
      failures++;
      continue;
    }
    const bare = bareImports(file);
    const specifiers = [...bare.keys()].sort();
    console.log(`${entry}${format}: ${specifiers.length === 0 ? "(no imports)" : specifiers.join(", ")}`);
    for (const specifier of specifiers) {
      const pkg = packageName(specifier);
      if (!forbids(entry, pkg)) continue;
      failures++;
      const note = NOTES[`${entry} ${pkg}`];
      console.error(`  ✗ ${entry} must not load ${pkg}${note === undefined ? "" : ` (${note})`}`);
      console.error(`    ${[...bare.get(specifier), specifier].join(" → ")}`);
    }
  }
}

if (failures > 0) {
  console.error(`${failures} bundle isolation failure(s)`);
  process.exit(1);
}
