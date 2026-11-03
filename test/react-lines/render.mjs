// Renders a hook- and context-using document through the built ESM output and checks the text
// reached word/document.xml, that an error boundary's fallback renders, and that a thrown
// `undefined` still fails the render. Usage: node [--import <hook>] render.mjs <expected React version>
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

/** A user error boundary: React reports the caught error and renders the fallback. */
class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? h(Paragraph, null, h(TextRun, { text: "fallback text" })) : this.props.children;
  }
}

function Throws({ value }) {
  throw value;
}

/** React logs every render error it reports; the checks below expect those errors. */
async function quietly(run) {
  const log = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = log;
  }
}

async function documentXml(element) {
  return strFromU8(unzipSync(new Uint8Array(await renderToBuffer(element)))["word/document.xml"]);
}

try {
  if (React.version !== expectedVersion) {
    throw new Error(`expected React ${expectedVersion}, loaded ${React.version}`);
  }
  const element = h(Document, null, h(Section, null, h(Label.Provider, { value: "context text" }, h(Body))));
  const xml = await documentXml(element);
  if (!xml.includes("context text via useState")) {
    throw new Error(`word/document.xml lacks the context-supplied text:\n${xml}`);
  }

  const caught = h(Document, null, h(Section, null, h(Boundary, null, h(Throws, { value: new Error("boom") }))));
  const fallback = await quietly(() => documentXml(caught));
  if (!fallback.includes("fallback text")) {
    throw new Error(`an error boundary's fallback is missing from word/document.xml:\n${fallback}`);
  }
  const uncaught = h(Document, null, h(Section, null, h(Throws, { value: undefined })));
  const outcome = await quietly(() => renderToBuffer(uncaught).then(() => "resolved", (error) => error));
  if (outcome !== undefined) {
    throw new Error(`a component throwing undefined should reject with undefined, got ${String(outcome)}`);
  }
  console.log(`ok ${React.version} esm`);
} catch (error) {
  console.error(`FAIL ${React.version} esm`, error);
  process.exit(1);
}
