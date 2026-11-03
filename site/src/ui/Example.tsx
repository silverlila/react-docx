import { useMemo, useState, type ComponentType } from "react";
import { renderToBlob, renderToTree } from "@react-docx/core";
import { CodeBlock } from "./CodeBlock";
import { DocumentCanvas } from "./DocumentCanvas";
import { DownloadIcon } from "./icons";
import { downloadBlob } from "../download";

/** An example's source beside the document that very source renders. Both come from one file. */
export function Example({
  component: Component,
  source,
  file,
  stacked = false,
}: {
  component: ComponentType;
  source: string;
  file: string;
  /** The document under the code at full width, cropped to its content, instead of a full page beside it. */
  stacked?: boolean;
}) {
  const tree = useMemo(() => renderToTree(<Component />), [Component]);
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      downloadBlob(await renderToBlob(tree), file.replace(/\.tsx$/, ".docx"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <figure className={stacked ? "example example-stacked" : "example"}>
      <CodeBlock code={source} title={file} />
      <div className="example-preview">
        <div className="example-label">
          <span>Rendered with DocxPreview</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={download} disabled={busy}>
            <DownloadIcon />
            {busy ? "Writing…" : "Download .docx"}
          </button>
        </div>
        <DocumentCanvas document={tree} pages={!stacked} />
      </div>
      <figcaption className="visually-hidden">{`${file} and the document it renders`}</figcaption>
    </figure>
  );
}
