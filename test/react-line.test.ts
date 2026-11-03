import { describe, expect, test } from "vitest";
import { reactLine } from "../src/tree/react-line";

describe("React version picks a reconciler line", () => {
  test.each([
    ["18.2.0", "29"],
    ["18.3.1", "29"],
    ["19.0.0", "31"],
    ["19.0.0-rc-66855b96-20241106", "31"],
    ["19.1.0", "31"],
    ["19.1.4", "31"],
    ["19.2.0", "33"],
    ["19.3.1", "33"],
    ["19.4.0-canary-1", "33"],
  ])("React %s runs on react-reconciler line %s", (version, line) => {
    expect(reactLine(version)).toBe(line);
  });

  test.each(["17.0.2", "20.0.0", "abc"])("React %s is unsupported", (version) => {
    expect(() => reactLine(version)).toThrow(
      new Error(`react-docx supports React 18 and 19, found ${version}`)
    );
  });
});
