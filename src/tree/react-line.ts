export type ReactLine = "29" | "31" | "33";

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
