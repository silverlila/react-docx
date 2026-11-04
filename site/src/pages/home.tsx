import { mount } from "../shell";
import { CodeBlock, InstallCommand } from "../ui/CodeBlock";
import { Example } from "../ui/Example";
import { ArrowRightIcon } from "../ui/icons";
import Invoice from "../examples/invoice";
import invoiceSource from "../examples/invoice.tsx?raw";

const PATHS = [
  {
    from: "JSX",
    to: ".docx",
    title: "Write",
    body: "Components, hooks and context all work. Render on a server, or to a Blob in the browser.",
    code: `const buffer = await renderToBuffer(<Invoice data={data} />);`,
  },
  {
    from: ".docx",
    to: "tree",
    title: "Read",
    body: "Open any Word file in Node or the browser. Whatever it cannot keep is listed, never lost silently.",
    code: `const { document, diagnostics } = readDocx(bytes);`,
  },
  {
    from: "tree",
    to: "JSX",
    title: "Generate",
    body: "Design a template in Word, then keep editing it as a React component in your codebase.",
    code: `const { source, assets } = printJsx(document);`,
  },
  {
    from: "tree",
    to: "HTML",
    title: "Preview",
    body: "Show the document in your app, laid out on pages. The preview entry loads no docx.js.",
    code: `<DocxPreview document={renderToTree(<Invoice />)} />`,
  },
] as const;

const DOCX_JS = `new Document({
  sections: [{
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: "Title", bold: true, size: 32 }),
        ],
      }),
    ],
  }],
});`;

const REACT_DOCX = `<Document>
  <Section>
    <Paragraph alignment="center">
      <TextRun text="Title" bold size={32} />
    </Paragraph>
  </Section>
</Document>`;

function Home() {
  return (
    <>
      <section className="hero container">
        <p className="eyebrow">Open source · React 18 and 19</p>
        <h1 className="display hero-title">Word documents, written in React.</h1>
        <p className="lead">
          Build <code>.docx</code> files from components that map one-to-one to docx.js. Read existing Word files
          back into JSX, and preview either one as HTML in the browser.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary" href="/docs/">
            Get started
            <ArrowRightIcon />
          </a>
          <a className="btn btn-secondary" href="/preview/">
            Preview a .docx
          </a>
        </div>
        <InstallCommand command="pnpm add @react-docx/core docx" />
      </section>

      <section className="container showcase" aria-label="Example">
        <Example component={Invoice} source={invoiceSource} file="Invoice.tsx" />
        <p className="showcase-note">
          This page renders the document live from Invoice.tsx. Download it and open it in Word.
        </p>
      </section>

      <section className="container band" aria-labelledby="paths-title">
        <div className="band-head">
          <h2 id="paths-title" className="display section-title">
            One document tree, four directions.
          </h2>
          <p className="lead">
            Every path meets at the same plain-data tree, so a document you wrote and a document you read are the
            same kind of thing.
          </p>
        </div>
        <div className="paths">
          {PATHS.map((path) => (
            <article key={path.title} className="path-card">
              <div className="path-route">
                <span>{path.from}</span>
                <ArrowRightIcon />
                <span>{path.to}</span>
              </div>
              <h3>{path.title}</h3>
              <p>{path.body}</p>
              <CodeBlock code={path.code} />
            </article>
          ))}
        </div>
      </section>

      <section className="container band compare" aria-labelledby="compare-title">
        <div className="band-head">
          <h2 id="compare-title" className="display section-title">
            The props are docx.js’s own.
          </h2>
          <p className="lead">
            There is no style layer to learn. Sizes stay in half-points, spacing in twips and colours in hex, so the
            docx.js documentation already describes every prop.
          </p>
        </div>
        <div className="compare-grid">
          <CodeBlock code={DOCX_JS} title="docx.js" />
          <CodeBlock code={REACT_DOCX} title="react-docx" />
        </div>
      </section>

      <section className="container">
        <div className="cta">
          <div>
            <h2 className="display cta-title">Have a Word file at hand?</h2>
            <p>
              Open it in the previewer to see it as HTML, as JSX, and as a list of anything the reader could not
              keep. The file is read on the page and never uploaded.
            </p>
          </div>
          <a className="btn btn-primary" href="/preview/">
            Open the previewer
            <ArrowRightIcon />
          </a>
        </div>
      </section>
    </>
  );
}

mount("home", <Home />);
