import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test(".gitignore ignores generated example documents", () => {
  const lines = readFileSync(resolve(__dirname, "..", ".gitignore"), "utf8")
    .split("\n")
    .map((l) => l.trim());
  expect(lines).toContain("examples/*.docx");
});
