# 02 — React 18 and React 19 in one package

> Part of `00-context.md`. **Read that first.** This file assumes its background, decisions and out-of-scope list and does not repeat them.

- **Satisfies**: AC5, AC6
- **You will see**: `pnpm run test:react` builds the package and renders a hook- and context-using document through the built `dist/`, in both ESM and CommonJS form, under React 18.3.1, 19.0.0, 19.1.0, 19.2.0 and 19.3.1. It prints one `ok` line per version and format.

## Goal

Replace the React-18-only reconciler with three reconcilers, one per React line, picked at runtime from `React.version`, with a synchronous render on every line.

The host instances stay the existing `MutableNode` classes from `src/nodes.ts`. Unit 04 replaces them with plain nodes. Writer output does not change, and the characterization snapshots from unit 01 must pass untouched.

## Files

- `package.json`: dependencies, peer range, the `test:react` script.
- `pnpm-lock.yaml`: regenerated.
- `src/tree/reconcilers.d.ts`: new. Module declarations for the three aliased packages.
- `src/tree/react-line.ts`: new. Maps a version string to a line.
- `src/tree/host-config.ts`: new. The shared host config plus the 18 and 19 variants.
- `src/tree/render.ts`: new. Runs the synchronous render on the selected line.
- `src/renderer.ts`: use `src/tree/render.ts` instead of `DocxReconciler`.
- `src/reconciler-v19.ts`: delete. Its `createMutableNode` switch moves into `src/tree/host-config.ts` unchanged.
- `test/react-line.test.ts`: new (AC6).
- `test/react-lines/hooks/react-19-0.mjs`, `react-19-1.mjs`, `react-19-2.mjs`, `react-19-3.mjs`: new.
- `test/react-lines/render.mjs`, `test/react-lines/render.cjs`, `test/react-lines/run.mjs`: new (AC5).

## Changes

### 1. Dependencies (`package.json`)

```jsonc
"peerDependencies": { "react": "^18.2.0 || ^19.0.0", "docx": "^8.0.0 || ^9.0.0" },   // docx range changes in unit 04
"dependencies": {
  "react-reconciler-29": "npm:react-reconciler@0.29.0",
  "react-reconciler-31": "npm:react-reconciler@0.31.0",
  "react-reconciler-33": "npm:react-reconciler@0.33.0"
},
"devDependencies": {
  // keep the existing ones, plus:
  "react-19-0": "npm:react@19.0.0",
  "react-19-1": "npm:react@19.1.0",
  "react-19-2": "npm:react@19.2.0",
  "react-19-3": "npm:react@19.3.1"
}
```

- Remove `"react-reconciler": "0.29.0"` from `dependencies`.
- Remove `@types/react-reconciler` from `devDependencies`. The aliased packages get local declarations in Change 2.
- Keep `"react": "^18.2.0"` in devDependencies. It installs 18.3.1 and remains the line that `pnpm test` runs on.
- Add `"test:react": "pnpm run build && node test/react-lines/run.mjs"`.

**The reconcilers stay external.** tsup externalizes `dependencies` by default; do not add them to `noExternal`. Verified 2026-11-03: esbuild bundling a reconciler into ESM output throws `Dynamic require of "react" is not supported` at load time. The reconcilers must stay external so that their `require("react")` resolves to the user's React.

pnpm prints peer-dependency warnings on install: react-reconciler-31 and -33 want React 19, while the repo's React is 18. That is expected. Each line only ever runs with the React it expects.

### 2. `src/tree/reconcilers.d.ts`

The three builds have different container APIs, so declare only what `render.ts` calls:

```ts
declare module "react-reconciler-29" {
  type Root = unknown;
  interface Reconciler29 {
    createContainer(container: unknown, tag: 0, hydration: null, strict: boolean, concurrentOverride: null,
      identifierPrefix: string, onRecoverableError: (e: unknown) => void, transitionCallbacks: null): Root;
    updateContainer(element: unknown, root: Root, parent: null, callback: (() => void) | null): void;
  }
  const factory: (hostConfig: object) => Reconciler29;
  export default factory;
}
declare module "react-reconciler-31" { /* same, but: */
  // createContainer(container, tag: 0 | 1, hydration: null, strict: boolean, concurrentOverride: null,
  //   identifierPrefix: string, onUncaughtError: (e: unknown) => void, onCaughtError: (e: unknown) => void,
  //   onRecoverableError: (e: unknown) => void, transitionCallbacks: null): Root
  // updateContainerSync(element, root, parent: null, callback: null): void
  // flushSyncWork(): void
}
declare module "react-reconciler-33" { /* identical to -31 */ }
```

Write them out fully. Do not leave comment placeholders.

### 3. `src/tree/react-line.ts`

```ts
export type ReactLine = "29" | "31" | "33";
/** "18.x" → "29"; "19.0.x" | "19.1.x" → "31"; "19.2.x" and any later 19 minor → "33".
 *  Prerelease suffixes are ignored ("19.0.0-rc-abc" → "31"). Anything else throws
 *  `react-docx supports React 18 and 19, found ${version}`. */
export function reactLine(version: string): ReactLine;
```

Parse major and minor with `/^(\d+)\.(\d+)/`.

### 4. `src/tree/host-config.ts`

Move `createMutableNode` from `src/reconciler-v19.ts` here unchanged, including the `switch` over `"RDDocument"`… and the `throw new Error(\`Unknown element type: ${type}\`)`. Unit 04 replaces it.

Then build one shared base object and two variants. This set of keys was run successfully on all five React versions on 2026-11-03. The spike used plain-object nodes; here `createInstance` returns `createMutableNode(type, props)` and the mutation methods operate on `.children` exactly as `src/reconciler-v19.ts` does today.

```ts
import React from "react";

const base = {
  supportsMutation: true, supportsPersistence: false, supportsHydration: false, isPrimaryRenderer: false,
  createInstance, createTextInstance, appendInitialChild, appendChild, appendChildToContainer,
  insertBefore, removeChild, removeChildFromContainer, clearContainer, commitTextUpdate,
  finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
  getRootHostContext: () => ({}), getChildHostContext: (h: object) => h, getPublicInstance: (i: unknown) => i,
  prepareForCommit: () => null, resetAfterCommit: () => {}, preparePortalMount: () => {},
  scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
  getInstanceFromNode: () => null, beforeActiveInstanceBlur() {}, afterActiveInstanceBlur() {},
  prepareScopeUpdate() {}, getInstanceFromScope: () => null, detachDeletedInstance() {},
};

/** react-reconciler 0.29 (React 18). */
export const hostConfig18 = {
  ...base,
  prepareUpdate: () => true,
  commitUpdate(instance, _payload, _type, _old, newProps) { /* instance.props = newProps without children */ },
  getCurrentEventPriority: () => 16,          // DefaultEventPriority
};

let updatePriority = 0;
/** react-reconciler 0.31 / 0.33 (React 19). */
export const hostConfig19 = {
  ...base,
  commitUpdate(instance, _type, _old, newProps) { /* same, 4 args: no updatePayload */ },
  setCurrentUpdatePriority: (p: number) => { updatePriority = p; },
  getCurrentUpdatePriority: () => updatePriority,
  resolveUpdatePriority: () => updatePriority || 32,   // 32 = DefaultEventPriority in 0.31+
  resolveEventType: () => null, resolveEventTimeStamp: () => -1.1,
  shouldAttemptEagerTransition: () => false,
  NotPendingTransition: null,
  HostTransitionContext: React.createContext(null),    // must be a real context of the user's React
  resetFormInstance() {}, requestPostPaintCallback() {},
  maySuspendCommit: () => false, preloadInstance: () => true,
  startSuspendingCommit() {}, suspendInstance() {}, waitForCommitToBeReady: () => null,
  trackSchedulerEvent() {}, resolveTransitionIndicator() {},   // read by 0.33
};
```

Type each config with a local `HostConfig` interface or `satisfies Record<string, unknown>`. Do not use `as any` on the whole object as `src/reconciler-v19.ts` does today; list the members.

### 5. `src/tree/render.ts`

```ts
import React from "react";
import Reconciler29 from "react-reconciler-29";
import Reconciler31 from "react-reconciler-31";
import Reconciler33 from "react-reconciler-33";

/** Renders synchronously and returns the root host instance (the DocumentNode), or throws the render error. */
export function renderToHost(element: React.ReactElement): MutableNode | null;
```

- **Line selection.** `reactLine(React.version)` picks the line. Create each reconciler lazily the first time its line is used, and cache it in a module variable. Importing all three is safe under any React version: the spike imported all three under every version.
- **Line 29:** `createContainer(container, 0, null, false, null, "", onRecoverable, null)` then `updateContainer(element, root, null, null)`. Render errors throw out of `updateContainer` directly (verified).
- **Lines 31 and 33:**
  1. Keep `let error: unknown = undefined`. Pass a callback that records the first error as `onUncaughtError`, `onCaughtError` and `onRecoverableError`.
  2. Call `createContainer(container, 0, null, false, null, "", cb, cb, cb, null)`, then `updateContainerSync(element, root, null, null)`, then `flushSyncWork()`.
  3. If `error !== undefined`, throw it. Verified: a component throwing `new Error("boom")` reaches the caller as that same error.
- **Return value.** The container is `{ rootInstance: null }`, as today's `DocxContainer`, and `appendChildToContainer` sets `rootInstance`. Return `container.rootInstance`.

### 6. `src/renderer.ts`

Replace the `DocxReconciler.createContainer(...)` and `updateContainer(...)` block with `const documentNode = renderToHost(element)`. The `instanceof DocumentNode` check, `ensureNumberingConfig`, `transformNodeToDocx` and the exported functions stay exactly as they are.

### 7. `test/react-line.test.ts` (AC6)

A table test over `reactLine`. Each version must map to the line shown or throw:

| Version | Result |
|---|---|
| `"18.2.0"` | 29 |
| `"18.3.1"` | 29 |
| `"19.0.0"` | 31 |
| `"19.0.0-rc-66855b96-20241106"` | 31 |
| `"19.1.0"` | 31 |
| `"19.1.4"` | 31 |
| `"19.2.0"` | 33 |
| `"19.3.1"` | 33 |
| `"19.4.0-canary-1"` | 33 |
| `"17.0.2"` | throws the message from Change 3 |
| `"20.0.0"` | throws the message from Change 3 |
| `"abc"` | throws the message from Change 3 |

### 8. The React matrix against `dist/` (AC5)

**Why this is not a vitest test.** A reconciler is CommonJS that calls `require("react")`, and vitest's `resolve.alias` does not reach a CommonJS `require` inside a dependency. Verified 2026-11-03: every 19.x project failed with `Cannot read properties of undefined (reading 'S')`, because the reconciler still saw React 18. Node's `module.registerHooks` does reach it.

**`test/react-lines/hooks/react-19-X.mjs`.** One file per aliased React. Shown for 19.2:

```js
import { registerHooks } from "node:module";
const root = new URL("../../../", import.meta.url).href;   // repo root, where react-19-2 is resolvable
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" || specifier.startsWith("react/")) {
      return nextResolve(specifier.replace(/^react/, "react-19-2"), { ...context, parentURL: root });
    }
    return nextResolve(specifier, context);
  },
});
```

The `parentURL: root` is required. Under pnpm, `react-19-2` is not resolvable from inside `node_modules/.pnpm/react-reconciler@…`.

**`test/react-lines/render.mjs` and `render.cjs`.** Each imports or requires `react` and `../../dist/index.mjs` / `../../dist/index.js`. It builds the document with `React.createElement`, so there is no JSX transform: a function component using `useState` and `useContext` (a Provider above it supplies the text) renders `<Paragraph><TextRun text={…} /></Paragraph>` inside `<Document><Section>`. Then it:
1. calls `renderToBuffer`;
2. unzips with fflate;
3. asserts `word/document.xml` contains the context-supplied text;
4. prints `ok <React.version> <esm|cjs>`;
5. exits 1 on any failure.

**`test/react-lines/run.mjs`.** For each entry in this list, spawn `node [--import <hook>] <script>` for both scripts with `spawnSync` and `stdio: "inherit"`, and exit non-zero if any child fails:

```js
[{ version: "18.3.1", hook: null, line: "29" },
 { version: "19.0.0", hook: "react-19-0", line: "31" },
 { version: "19.1.0", hook: "react-19-1", line: "31" },
 { version: "19.2.0", hook: "react-19-2", line: "33" },
 { version: "19.3.1", hook: "react-19-3", line: "33" }]
```

`hook: null` means no `--import`, because the repo's own `react` is 18.3.1. Print each expected line next to its result. A wrong line cannot pass silently: a reconciler running under the wrong React crashes at its first render, as the 2026-11-03 spike showed.

## Verify

```sh
pnpm install
pnpm test                 # characterization snapshots unchanged; react-line table passes
pnpm run type-check
pnpm run test:react       # 10 "ok" lines: 5 versions × esm/cjs
```

## Watch out

- `module.registerHooks` needs Node 22.15 or 23.5+. Local Node is 25.2.1. The release workflow uses Node 24 but does not run tests.
- `HostTransitionContext` must be created with `React.createContext` from the `react` the library imports, which is the user's React. A plain object crashes 0.31+.
- Do not unmount the root after rendering. Nothing in the tree is read after it is returned, and an unmount would run `removeChildFromContainer` and set `rootInstance` to null while callers still hold it.
- The snapshot file from unit 01 must not change in this unit. If it does, the host config has drifted from `src/reconciler-v19.ts`'s mutation behavior.
