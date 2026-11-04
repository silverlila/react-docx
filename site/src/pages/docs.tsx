import { useEffect, useState, type ReactNode } from "react";
import { mount } from "../shell";
import { CodeBlock } from "../ui/CodeBlock";
import { Example } from "../ui/Example";
import Hello from "../examples/hello";
import helloSource from "../examples/hello.tsx?raw";
import Formatting from "../examples/formatting";
import formattingSource from "../examples/formatting.tsx?raw";
import Lists from "../examples/lists";
import listsSource from "../examples/lists.tsx?raw";
import StatusTable from "../examples/table";
import tableSource from "../examples/table.tsx?raw";
import Report from "../examples/header-footer";
import reportSource from "../examples/header-footer.tsx?raw";

const NAV: readonly { group: string; items: readonly [id: string, label: string][] }[] = [
  { group: "Getting started", items: [["introduction", "Introduction"], ["installation", "Installation"], ["first-document", "Your first document"]] },
  { group: "Writing", items: [["text", "Text and paragraphs"], ["units", "Units"], ["lists", "Lists"], ["tables", "Tables"], ["headers-footers", "Headers and footers"], ["components", "Components"]] },
  { group: "Output", items: [["rendering", "Rendering"], ["placement", "Placement errors"]] },
  { group: "Reading Word files", items: [["reading", "readDocx"], ["diagnostics", "Diagnostics"], ["codegen", "Generating JSX"]] },
  { group: "In the browser", items: [["preview", "DocxPreview"], ["limits", "Known limits"]] },
];

function useCurrentSection(ids: readonly string[]): string {
  const [current, setCurrent] = useState(ids[0]);
  useEffect(() => {
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = ids.find((id) => visible.has(id));
        if (first) setCurrent(first);
      },
      { rootMargin: "-80px 0px -60% 0px" },
    );
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [ids]);
  return current;
}

const IDS = NAV.flatMap((group) => group.items.map(([id]) => id));

function Docs() {
  const current = useCurrentSection(IDS);
  return (
    <div className="container docs">
      <aside className="docs-nav" aria-label="Documentation">
        {NAV.map((group) => (
          <div key={group.group} className="docs-nav-group">
            <p className="docs-nav-title">{group.group}</p>
            <ul>
              {group.items.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`} aria-current={current === id ? "location" : undefined}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </aside>

      <article className="docs-body">
        <header className="docs-head">
          <p className="eyebrow">Documentation</p>
          <h1 className="display">Write, read and preview Word documents in React</h1>
        </header>

        <Section id="introduction" title="Introduction">
          <p>
            react-docx is a React renderer for <a href="https://docx.js.org">docx.js</a>. You describe a document with
            components such as <code>&lt;Paragraph&gt;</code> and <code>&lt;TextRun&gt;</code>, and react-docx turns
            them into a <code>.docx</code> file. Each component takes the options of the docx.js class of the same
            name as its props, so nothing is renamed or converted.
          </p>
          <p>
            It also works the other way: it reads an existing Word file into the same document tree, prints that tree
            as a React component, and draws it as HTML. The package has four entry points:
          </p>
          <Table
            head={["Import", "What it gives you"]}
            rows={[
              [<code>@react-docx/core</code>, "The components, renderToBuffer, renderToBlob, renderToBase64 and renderToTree"],
              [<code>@react-docx/core/reader</code>, "readDocx: a .docx file to a document tree, in Node or the browser"],
              [<code>@react-docx/core/codegen</code>, "printJsx: a document tree to the source of a React component"],
              [<code>@react-docx/core/html</code>, "DocxPreview: a document tree drawn as HTML, without loading docx.js"],
            ]}
          />
        </Section>

        <Section id="installation" title="Installation">
          <CodeBlock code="pnpm add @react-docx/core docx react" language="sh" />
          <p>
            <code>react</code> (18.2 or later, including 19) and <code>docx</code> (9.5 or later) are peer
            dependencies, so your project chooses their versions. TypeScript types ship with the package.
          </p>
        </Section>

        <Section id="first-document" title="Your first document">
          <p>
            A document is a <code>&lt;Document&gt;</code> holding one or more <code>&lt;Section&gt;</code>s, which hold
            paragraphs and tables. Every example on this page is rendered live, and the download button writes the
            real <code>.docx</code> in your browser.
          </p>
          <Example component={Hello} source={helloSource} file="Hello.tsx" stacked />
          <p>To write it to disk in Node, render it to a buffer:</p>
          <CodeBlock
            title="write.tsx"
            code={`import { writeFileSync } from "node:fs";
import { renderToBuffer } from "@react-docx/core";
import Hello from "./Hello";

writeFileSync("hello.docx", await renderToBuffer(<Hello />));`}
          />
        </Section>

        <Section id="text" title="Text and paragraphs">
          <p>
            A <code>&lt;Paragraph&gt;</code> holds runs of text. Alignment, spacing, indents and borders go on the
            paragraph; font, size, colour, bold and the like go on each <code>&lt;TextRun&gt;</code>. Hooks, context
            and your own components work as they do in any React app.
          </p>
          <Example component={Formatting} source={formattingSource} file="Formatting.tsx" stacked />
        </Section>

        <Section id="units" title="Units">
          <p>Values are in Word’s own units, as docx.js takes them:</p>
          <Table
            head={["Value", "Unit", "Example"]}
            rows={[
              ["Font size", "Half-points", <code>size={"{24}"} is 12pt</code>],
              ["Spacing, indents, margins, page size", "Twips: 1/20 pt, 1440 per inch", <code>indent={"{{ left: 720 }}"} is ½ inch</code>],
              ["Colour", "Hex, without #", <code>color="2F5BD3"</code>],
              ["Borders", "Eighths of a point", <code>size: 4 is ½pt</code>],
              ["Image size", "Pixels", <code>transformation={"{{ width: 120, height: 80 }}"}</code>],
            ]}
          />
        </Section>

        <Section id="lists" title="Lists">
          <p>
            A <code>&lt;List&gt;</code> becomes numbered paragraphs. Nest a <code>&lt;List&gt;</code> inside a{" "}
            <code>&lt;ListItem&gt;</code> for a deeper level.
          </p>
          <Example component={Lists} source={listsSource} file="Lists.tsx" stacked />
          <ul className="docs-list">
            <li>
              <code>type</code> is <code>"bullet"</code> (the default) or <code>"numbered"</code>. Each list numbers
              from 1.
            </li>
            <li>Lists nest up to 9 deep, Word’s number of levels.</li>
            <li>
              To change the markers, give the <code>Document</code> a <code>numbering</code> config for the reference{" "}
              <code>"NumberedList"</code> or <code>"BulletList"</code>, in docx.js’s format.
            </li>
          </ul>
        </Section>

        <Section id="tables" title="Tables">
          <p>
            Tables are <code>&lt;Table&gt;</code>, <code>&lt;TableRow&gt;</code> and <code>&lt;TableCell&gt;</code>,
            and a cell holds paragraphs. Widths take a <code>type</code>: <code>"dxa"</code> for twips or{" "}
            <code>"pct"</code> for a percentage. This one is 6.5 inches, the width of a Letter page inside 1-inch margins.
            Merge cells with <code>columnSpan</code> and <code>rowSpan</code>.
          </p>
          <Example component={StatusTable} source={tableSource} file="StatusTable.tsx" stacked />
        </Section>

        <Section id="headers-footers" title="Headers and footers">
          <p>
            Put <code>&lt;Header&gt;</code> and <code>&lt;Footer&gt;</code> directly inside a{" "}
            <code>&lt;Section&gt;</code>. They hold the same content as a section. A <code>PageNumber</code> value from{" "}
            <code>docx</code> in a run’s children becomes a Word field.
          </p>
          <Example component={Report} source={reportSource} file="Report.tsx" stacked />
          <ul className="docs-list">
            <li>
              <code>type</code> is <code>"default"</code>, <code>"first"</code> or <code>"even"</code>.
            </li>
            <li>
              A <code>"first"</code> header shows only when the section sets <code>properties.titlePage</code>. An{" "}
              <code>"even"</code> header needs the document’s <code>evenAndOddHeaderAndFooters</code>.
            </li>
            <li>The preview shows each page’s own number, the page count and the section’s number.</li>
          </ul>
        </Section>

        <Section id="components" title="Components">
          <p>
            Each component takes the options of its docx.js counterpart as props. <code>List</code> and{" "}
            <code>ListItem</code> become numbered paragraphs, and <code>RawXml</code> writes WordprocessingML you
            supply, for anything else.
          </p>
          <Table
            head={["Group", "Components"]}
            rows={[
              ["Structure", "Document, Section, Header, Footer"],
              ["Blocks", "Paragraph, Table, TableRow, TableCell, List, ListItem, TableOfContents, Textbox"],
              ["Runs", "TextRun, ImageRun, SymbolRun, Math, MathRun"],
              ["Links and anchors", "ExternalHyperlink, InternalHyperlink, Bookmark, PageReference"],
              ["Breaks and spacing", "Break, PageBreak, ColumnBreak, Tab, PositionalTab, CarriageReturn, SoftHyphen, NoBreakHyphen"],
              ["Notes and comments", "Footnote, Comment, CommentRangeStart, CommentRangeEnd, CommentReference"],
              ["Tracked changes", "InsertedTextRun, DeletedTextRun"],
              ["Fields", "SimpleField, SimpleMailMergeField, SequentialIdentifier, DayShort, DayLong, MonthShort, MonthLong, YearShort, YearLong"],
              ["Form controls", "CheckBox"],
              ["Anything else", "RawXml"],
            ]}
          />
        </Section>

        <Section id="rendering" title="Rendering">
          <p>
            Each function takes a JSX element, or a tree from <code>renderToTree</code> or <code>readDocx</code>.
          </p>
          <Table
            head={["Function", "Returns", "Use it for"]}
            rows={[
              [<code>renderToBuffer</code>, <code>Promise&lt;Buffer&gt;</code>, "Writing files or HTTP responses in Node"],
              [<code>renderToBlob</code>, <code>Promise&lt;Blob&gt;</code>, "Downloads in the browser"],
              [<code>renderToBase64</code>, <code>Promise&lt;string&gt;</code>, "APIs that take base64, in Node or the browser"],
              [<code>renderToTree</code>, <code>DocumentNode</code>, "The document as plain data, for DocxPreview or tests"],
            ]}
          />
          <CodeBlock
            title="download.tsx"
            code={`const blob = await renderToBlob(<Resume data={data} />);
const link = document.createElement("a");
link.href = URL.createObjectURL(blob);
link.download = "resume.docx";
link.click();`}
          />
        </Section>

        <Section id="placement" title="Placement errors">
          <p>
            Every element must sit where Word allows it. When one does not, rendering throws a{" "}
            <code>TreeError</code> that names its place in the document. Most often an inline element such as a{" "}
            <code>TextRun</code> or <code>PageBreak</code> sits directly in a section, header or cell, when it belongs in
            a paragraph:
          </p>
          <CodeBlock code="Document > Section[0] > PageBreak[0]: <PageBreak> is not allowed in <Section>" language="sh" />
          <p>
            A prop value that docx.js would write into a file Word cannot open throws the same way: a{" "}
            <code>SymbolRun</code> <code>char</code> that is not four hex digits such as <code>"F071"</code>, an{" "}
            <code>ImageRun</code> <code>type</code> other than jpg, png, gif, bmp or svg, an svg <code>ImageRun</code>{" "}
            without a raster <code>fallback</code>, and a <code>Textbox</code> <code>style</code> value of the wrong
            kind, such as a length that is not a CSS length.
          </p>
        </Section>

        <Section id="reading" title="readDocx">
          <p>
            <code>readDocx</code> turns a <code>.docx</code> into the same tree that <code>renderToTree</code> returns.
            It is synchronous, takes a <code>Uint8Array</code> or <code>ArrayBuffer</code>, and needs neither Node nor
            docx.js, so it runs in the browser too.
          </p>
          <CodeBlock
            title="read.ts"
            code={`import { readFileSync, writeFileSync } from "node:fs";
import { renderToBuffer } from "@react-docx/core";
import { readDocx } from "@react-docx/core/reader";

const { document, diagnostics } = readDocx(readFileSync("resume.docx"));

// The tree writes straight back to a .docx.
writeFileSync("resume.rewritten.docx", await renderToBuffer(document));`}
          />
          <p>
            Bytes that are not a Word file throw <code>NotADocxError</code>. The first write can normalise a file
            saved by Word; reading and writing again after that gives the same document every time.
          </p>
        </Section>

        <Section id="diagnostics" title="Diagnostics">
          <p>
            Some of what Word stores has no react-docx prop. Rather than lose it quietly, <code>readDocx</code> lists
            every such element with the part of the file it came from and, where it has one, its path in the tree.
          </p>
          <Table
            head={["Kind", "Meaning"]}
            rows={[
              [<code>dropped</code>, "docx.js cannot write it, so it is gone after a write. A cropped image comes back uncropped, for example."],
              [<code>raw</code>, "Kept verbatim as a RawXml element. It is written back exactly, but cannot be edited as props."],
              [<code>resolved</code>, "A theme reference, such as a theme colour, replaced with its literal value."],
              [<code>ignored</code>, "Editing noise, such as revision ids and spell-check marks, counted by element name."],
            ]}
          />
          <p>
            The <a href="/preview/">previewer</a> shows these for any file you open, and links each one to its place in
            the preview.
          </p>
        </Section>

        <Section id="codegen" title="Generating JSX">
          <p>
            <code>printJsx</code> prints a tree as the source of a React component. Design a template in Word, read
            it, and keep editing it as code: rendering the printed component gives the same tree back.
          </p>
          <CodeBlock
            title="codegen.ts"
            code={`import { printJsx } from "@react-docx/core/codegen";

const { source, assets } = printJsx(document, { componentName: "Resume" });

writeFileSync("Resume.tsx", source);
for (const asset of assets) writeFileSync(asset.path, asset.bytes); // assets/image1.png, …`}
          />
          <p>
            Styles and numbering are hoisted into constants at the top of the module, images become files under{" "}
            <code>assets/</code>, and only the components the document uses are imported.
          </p>
        </Section>

        <Section id="preview" title="DocxPreview">
          <p>
            <code>DocxPreview</code> draws a tree as HTML on pages of the document’s page size, with its fonts,
            spacing, lists, tables, images, headers, footers and footnotes. It takes a tree rather than children, so
            render your JSX to a tree first.
          </p>
          <CodeBlock
            title="ResumePreview.tsx"
            code={`import { useMemo } from "react";
import { DocxPreview, renderToTree } from "@react-docx/core/html";

export function ResumePreview({ data }: { data: ResumeData }) {
  const tree = useMemo(() => renderToTree(<Resume data={data} />), [data]);
  return <DocxPreview document={tree} className="preview" />;
}`}
          />
          <ul className="docs-list">
            <li>
              A page ends at a page break, before a section that is not continuous and before a paragraph with{" "}
              <code>pageBreakBefore</code>, and
              where Word ended it when it last saved the file. In a browser the preview also measures each page and
              moves what does not fit to the next one; rendered on a server, a page that overflows grows instead.
            </li>
            <li>Every style is inline, so it needs no stylesheet. It forwards its ref and any div props.</li>
            <li>
              Every block carries <code>data-docx-path</code>, its path in the tree, for linking your UI to a place in
              the document.
            </li>
            <li>
              Links keep only <code>http:</code>, <code>https:</code>, <code>mailto:</code> and in-document targets,
              because a file’s links come from whoever wrote it.
            </li>
            <li>
              The <code>/html</code> entry loads no docx.js. It works the same for a tree you rendered and a tree you
              read.
            </li>
          </ul>
        </Section>

        <Section id="limits" title="Known limits">
          <ul className="docs-list">
            <li>
              Lines and pages break where the browser’s text layout puts them, so a page can end a few lines earlier
              or later than in Word.
            </li>
            <li>Fonts are the browser’s. A font the document names but the viewer lacks falls back to another.</li>
            <li>
              docx.js always writes table borders, so a table that relied on its table style can gain thin borders when
              read and written back.
            </li>
            <li>Embedded fonts, image cropping and a few drawing effects are dropped on a write, and listed as such.</li>
          </ul>
        </Section>
      </article>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="docs-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>
        <a href={`#${id}`}>{title}</a>
      </h2>
      {children}
    </section>
  );
}

function Table({ head, rows }: { head: readonly string[]; rows: readonly (readonly ReactNode[])[] }) {
  return (
    <div className="doc-table-wrap">
      <table className="doc-table">
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

mount("docs", <Docs />);
