const React = require("react");
const { strFromU8, unzipSync } = require("fflate");
const { Document, Paragraph, Section, TextRun, renderToBuffer } = require("../../dist/index.js");

const expectedVersion = process.argv[2];
const h = React.createElement;
const Label = React.createContext("label missing");

function Body() {
  const label = React.useContext(Label);
  const [text] = React.useState(() => `${label} via useState`);
  return h(Paragraph, null, h(TextRun, { text }));
}

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

function Reordered() {
  const [order, setOrder] = React.useState(["a", "b", "c", "d"]);
  React.useLayoutEffect(() => setOrder(["d", "c", "x", "a"]), []);
  return h(React.Fragment, null, ...order.map((key) => h(Paragraph, { key }, h(TextRun, { text: `item-${key}` }))));
}

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

async function main() {
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
  const reordered = await documentXml(h(Document, null, h(Section, null, h(Reordered))));
  const items = [...reordered.matchAll(/item-(\w)/g)].map((match) => match[1]).join(",");
  if (items !== "d,c,x,a") throw new Error(`keyed paragraphs reordered in a layout effect came out as ${items}`);
  console.log(`ok ${React.version} cjs`);
}

main().catch((error) => {
  console.error(`FAIL ${React.version} cjs`, error);
  process.exit(1);
});
