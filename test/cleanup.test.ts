import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(__dirname, "..");
const at = (path: string) => resolve(root, path);

describe("dead code is gone", () => {
  test.each([
    "plugins",
    "pnpm-workspace.yaml",
    "src/transformers/html-transformer.ts",
    "src/transformers/dom-transformer.ts",
  ])("%s does not exist", (path) => {
    expect(existsSync(at(path))).toBe(false);
  });

  test("package.json has no babel, mammoth or self devDependency", () => {
    const { devDependencies } = JSON.parse(readFileSync(at("package.json"), "utf8"));
    const names = Object.keys(devDependencies);
    expect(names.filter((name) => name.startsWith("@babel/"))).toEqual([]);
    expect(names).not.toContain("mammoth");
    expect(names).not.toContain("@react-docx/core");
  });

  test(".gitignore ignores generated example documents", () => {
    const lines = readFileSync(at(".gitignore"), "utf8").split("\n").map((l) => l.trim());
    expect(lines).toContain("examples/*.docx");
  });
});
