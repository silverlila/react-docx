import { ELEMENTS } from "../schema/elements";

const TAKEN_NAMES: ReadonlySet<string> = new Set([...Object.keys(ELEMENTS), "Date", "URL"]);

export function componentName(fileName: string): string {
  const pascal = fileName
    .replace(/\.docx$/i, "")
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  return /^[A-Za-z]/.test(pascal) && !TAKEN_NAMES.has(pascal) ? pascal : `Doc${pascal}`;
}
