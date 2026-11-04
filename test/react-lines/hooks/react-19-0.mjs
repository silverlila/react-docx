/** Under pnpm the aliased React is not resolvable from inside node_modules/.pnpm/react-reconciler@…,
 *  so resolution starts at the repo root. */

import { registerHooks } from "node:module";

const root = new URL("../../../", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" || specifier.startsWith("react/")) {
      return nextResolve(specifier.replace(/^react/, "react-19-0"), { ...context, parentURL: root });
    }
    return nextResolve(specifier, context);
  },
});
