// Renders a hook- and context-using document through the built ESM output and checks the text
// reached word/document.xml. Usage: node [--import <hook>] render.mjs <expected React version>
import React from "react";
import { strFromU8, unzipSync } from "fflate";
import { Document, Paragraph, Section, TextRun, renderToBuffer } from "../../dist/index.mjs";

const expectedVersion = process.argv[2];
const h = React.createElement;
const Label = React.createContext("label missing");

function Body() {
  const label = React.useContext(Label);
  const [text] = React.useState(() => `${label} via useState`);
  return h(Paragraph, null, h(TextRun, { text }));
}

try {
  if (React.version !== expectedVersion) {
    throw new Error(`expected React ${expectedVersion}, loaded ${React.version}`);
  }
  const element = h(Document, null, h(Section, null, h(Label.Provider, { value: "context text" }, h(Body))));
  const xml = strFromU8(unzipSync(new Uint8Array(await renderToBuffer(element)))["word/document.xml"]);
  if (!xml.includes("context text via useState")) {
    throw new Error(`word/document.xml lacks the context-supplied text:\n${xml}`);
  }
  console.log(`ok ${React.version} esm`);
} catch (error) {
  console.error(`FAIL ${React.version} esm`, error);
  process.exit(1);
}
