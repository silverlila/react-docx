/** Loaded with `node --import`: every "react" import, the reconciler's CommonJS require included,
 *  resolves to the aliased react-19-2 instead of the repo's React 18.
 *
 *  Under pnpm the aliased React is not resolvable from inside node_modules/.pnpm/react-reconciler@…,
 *  so resolution starts at the repo root. */

import { registerHooks } from "node:module";

const root = new URL("../../../", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" || specifier.startsWith("react/")) {
      return nextResolve(specifier.replace(/^react/, "react-19-2"), { ...context, parentURL: root });
    }
    return nextResolve(specifier, context);
  },
});
