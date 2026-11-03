// Loaded with `node --import`: every "react" import, including the reconciler's CommonJS
// require, resolves to the aliased react-19-2 instead of the repo's React 18.
import { registerHooks } from "node:module";

// The repo root, where react-19-2 is resolvable. Under pnpm it is not resolvable from inside
// node_modules/.pnpm/react-reconciler@…, so resolution must start here.
const root = new URL("../../../", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" || specifier.startsWith("react/")) {
      return nextResolve(specifier.replace(/^react/, "react-19-2"), { ...context, parentURL: root });
    }
    return nextResolve(specifier, context);
  },
});
