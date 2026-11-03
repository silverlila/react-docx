/** The react-reconciler build that matches a React version: 0.29, 0.31 or 0.33. */
export type ReactLine = "29" | "31" | "33";

/** "18.x" → "29"; "19.0.x" | "19.1.x" → "31"; "19.2.x" and any later 19 minor → "33".
 *  Prerelease suffixes are ignored ("19.0.0-rc-abc" → "31"). Anything else throws
 *  `react-docx supports React 18 and 19, found ${version}`. */
export function reactLine(version: string): ReactLine {
  const match = /^(\d+)\.(\d+)/.exec(version);
  if (match) {
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (major === 18) return "29";
    if (major === 19) return minor <= 1 ? "31" : "33";
  }
  throw new Error(`react-docx supports React 18 and 19, found ${version}`);
}
