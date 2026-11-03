/** Renders through the built dist/ under every supported React version, as ESM and as CommonJS.
 *
 *  Not a vitest test: vitest's resolve.alias does not reach the reconciler's CommonJS `require("react")`,
 *  while node's module.registerHooks, loaded with --import, does. */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

const MATRIX = [
  { version: "18.3.1", hook: null, line: "29" },
  { version: "19.0.0", hook: "react-19-0", line: "31" },
  { version: "19.1.0", hook: "react-19-1", line: "31" },
  { version: "19.2.0", hook: "react-19-2", line: "33" },
  { version: "19.3.1", hook: "react-19-3", line: "33" },
];

let failed = 0;
for (const { version, hook, line } of MATRIX) {
  for (const script of ["render.mjs", "render.cjs"]) {
    process.stdout.write(`React ${version}, expected line ${line}: `);
    const hookArgs = hook ? ["--import", here(`./hooks/${hook}.mjs`)] : [];
    const { status } = spawnSync(process.execPath, [...hookArgs, here(`./${script}`), version], {
      stdio: "inherit",
    });
    if (status !== 0) failed += 1;
  }
}

if (failed > 0) {
  console.error(`${failed} of ${MATRIX.length * 2} renders failed`);
  process.exit(1);
}
