/** scrollIntoView misplaces targets under CSS zoom, so scrolling to a block is computed by hand. */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { Diagnostic } from "@react-docx/core/reader";
import { GITHUB_URL, mount } from "../shell";
import { Code, CopyButton } from "../ui/CodeBlock";
import { Sheets, useFitZoom } from "../ui/DocumentCanvas";
import { AlertIcon, DownloadIcon, FileIcon, MinusIcon, PlusIcon, UploadIcon } from "../ui/icons";
import { downloadBlob } from "../download";
import { formatBytes, loadDocx, LoadError, moduleDownload, rewrittenDocx, sampleBytes, type LoadedFile } from "../load";
import Resume from "../examples/resume";
import StatusTable from "../examples/table";
import Report from "../examples/header-footer";

type State =
  | { readonly status: "empty" }
  | { readonly status: "reading"; readonly name: string }
  | { readonly status: "failed"; readonly name: string; readonly message: string; readonly bug: boolean }
  | { readonly status: "ready"; readonly file: LoadedFile };

const SAMPLES: readonly { name: string; label: string; component: ComponentType }[] = [
  { name: "resume.docx", label: "Resume", component: Resume },
  { name: "status-table.docx", label: "Table", component: StatusTable },
  { name: "report.docx", label: "Header and footer", component: Report },
];

const ACCEPT = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const HIGHLIGHT_LIMIT = 250_000;

const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

function PreviewPage() {
  const [state, setState] = useState<State>({ status: "empty" });

  async function open(name: string, bytes: () => Promise<Uint8Array>) {
    setState({ status: "reading", name });
    await nextFrame();
    try {
      setState({ status: "ready", file: loadDocx(name, await bytes()) });
    } catch (error) {
      const known = error instanceof LoadError;
      const message = error instanceof Error ? error.message : String(error);
      setState({ status: "failed", name, message, bug: !known });
    }
  }

  const openFile = (file: File) => open(file.name, async () => new Uint8Array(await file.arrayBuffer()));
  const dragging = useWindowDrop(openFile);

  return (
    <>
      {state.status === "ready" ? (
        <Workspace file={state.file} onOpen={openFile} />
      ) : (
        <Landing state={state} onOpen={openFile} onSample={(s) => open(s.name, () => sampleBytes(<s.component />))} />
      )}
      {dragging && state.status === "ready" ? (
        <div className="drop-overlay" aria-hidden="true">
          <UploadIcon />
          Drop to preview
        </div>
      ) : null}
    </>
  );
}

function useWindowDrop(onFile: (file: File) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(onFile);
  latest.current = onFile;
  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const file = event.dataTransfer?.files[0];
      if (file) latest.current(file);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return dragging;
}

function FilePicker({
  onOpen,
  children,
  className,
}: {
  onOpen: (file: File) => void;
  children: ReactNode;
  className: string;
}) {
  return (
    <label className={className}>
      <input
        type="file"
        accept={ACCEPT}
        className="visually-hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onOpen(file);
        }}
      />
      {children}
    </label>
  );
}

function Landing({
  state,
  onOpen,
  onSample,
}: {
  state: Exclude<State, { status: "ready" }>;
  onOpen: (file: File) => void;
  onSample: (sample: (typeof SAMPLES)[number]) => void;
}) {
  const reading = state.status === "reading";
  return (
    <section className="container landing">
      <div className="landing-head">
        <h1 className="display landing-title">Preview a Word file</h1>
        <p className="lead">
          See any <code>.docx</code> as HTML, as an editable React component, and as a report of everything the reader
          could not keep.
        </p>
      </div>

      {state.status === "failed" ? (
        <div className="callout" role="alert">
          <AlertIcon />
          <div>
            <strong>Could not read {state.name}.</strong>{" "}
            {state.bug ? (
              <>
                The reader hit an error it should not have: <code>{state.message}</code>. The file is most likely fine.{" "}
                <a href={`${GITHUB_URL}/issues/new`}>Report it on GitHub</a> so it can be fixed.
              </>
            ) : (
              state.message
            )}
          </div>
        </div>
      ) : null}

      <FilePicker onOpen={onOpen} className="dropzone">
        <span className="dropzone-icon">{reading ? <span className="spinner" /> : <UploadIcon />}</span>
        <span className="dropzone-title" aria-live="polite">
          {reading ? `Reading ${state.name}…` : "Drop a .docx here, or choose a file"}
        </span>
        <span className="dropzone-hint">Read on this page. Your file is never uploaded.</span>
      </FilePicker>

      <div className="samples">
        <span>No file at hand? Try a sample written by react-docx:</span>
        <div className="samples-list">
          {SAMPLES.map((sample) => (
            <button
              key={sample.name}
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={reading}
              onClick={() => onSample(sample)}
            >
              <FileIcon />
              {sample.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

type Tab = "preview" | "jsx" | "diagnostics";

function Workspace({ file, onOpen }: { file: LoadedFile; onOpen: (file: File) => void }) {
  const [tab, setTab] = useState<Tab>("preview");
  const [target, setTarget] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const fitting = useFitZoom(file.document);
  const effectiveZoom = zoom ?? fitting.fit;
  const id = useId();

  useEffect(() => {
    setTab("preview");
    setZoom(null);
  }, [file]);

  const lost = file.diagnostics.filter((d) => d.kind === "dropped" || d.kind === "raw").length;
  const sections = file.document.children.filter((node) => node.type === "Section").length;

  function show(path: string) {
    setTab("preview");
    setTarget(path);
  }

  const tabs: readonly { id: Tab; label: string; badge?: number }[] = [
    { id: "preview", label: "Preview" },
    { id: "jsx", label: "JSX" },
    { id: "diagnostics", label: "Diagnostics", badge: lost },
  ];

  return (
    <div className="workspace">
      <div className="toolbar">
        <div className="file-meta">
          <span className="file-icon">
            <FileIcon />
          </span>
          <div>
            <div className="file-name" title={file.name}>
              {file.name}
            </div>
            <div className="file-stats">
              {formatBytes(file.size)} · {sections} {sections === 1 ? "section" : "sections"} · read in{" "}
              {Math.max(1, Math.round(file.readMs))} ms
            </div>
          </div>
        </div>

        <TabList
          id={id}
          tabs={tabs}
          value={tab}
          onChange={(next) => {
            setTab(next);
            window.scrollTo({ top: 0 });
          }}
        />

        <div className="toolbar-actions">
          <div className="zoom-slot" style={{ visibility: tab === "preview" ? "visible" : "hidden" }}>
            <ZoomControls zoom={effectiveZoom} fitted={zoom === null} onChange={setZoom} />
          </div>
          <DownloadButtons file={file} />
          <FilePicker onOpen={onOpen} className="btn btn-ghost btn-sm file-picker-btn">
            <UploadIcon />
            Open another
          </FilePicker>
        </div>
      </div>

      <div className="panel" role="tabpanel" id={`${id}-${tab}`} aria-labelledby={`${id}-${tab}-tab`}>
        <div ref={fitting.ref} className="canvas panel-fill" hidden={tab !== "preview"}>
          <PreviewSheets file={file} zoom={effectiveZoom} target={target} onShown={() => setTarget(null)} />
        </div>
        {tab === "jsx" ? <JsxPanel file={file} /> : null}
        {tab === "diagnostics" ? <DiagnosticsPanel diagnostics={file.diagnostics} onShow={show} /> : null}
      </div>
    </div>
  );
}

function TabList({
  id,
  tabs,
  value,
  onChange,
}: {
  id: string;
  tabs: readonly { id: Tab; label: string; badge?: number }[];
  value: Tab;
  onChange: (tab: Tab) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  function onKeyDown(event: KeyboardEvent) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const index = (tabs.findIndex((t) => t.id === value) + step + tabs.length) % tabs.length;
    onChange(tabs[index].id);
    list.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[index]?.focus();
  }
  return (
    <div ref={list} className="tabs" role="tablist" aria-label="View" onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${id}-${t.id}-tab`}
          aria-selected={t.id === value}
          aria-controls={`${id}-${t.id}`}
          tabIndex={t.id === value ? 0 : -1}
          className="tab"
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.badge ? <span className="tab-badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

function ZoomControls({
  zoom,
  fitted,
  onChange,
}: {
  zoom: number;
  fitted: boolean;
  onChange: (zoom: number | null) => void;
}) {
  const smaller = [...ZOOM_STEPS].reverse().find((step) => step < zoom - 0.001);
  const larger = ZOOM_STEPS.find((step) => step > zoom + 0.001);
  return (
    <div className="zoom" role="group" aria-label="Zoom">
      <button
        type="button"
        className="zoom-btn"
        aria-label="Zoom out"
        disabled={!smaller}
        onClick={() => onChange(smaller ?? zoom)}
      >
        <MinusIcon />
      </button>
      <button
        type="button"
        className="zoom-value"
        onClick={() => onChange(null)}
        aria-label={fitted ? `Zoom ${Math.round(zoom * 100)}%, fitted to width` : "Fit to width"}
        title="Fit to width"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        className="zoom-btn"
        aria-label="Zoom in"
        disabled={!larger}
        onClick={() => onChange(larger ?? zoom)}
      >
        <PlusIcon />
      </button>
    </div>
  );
}

function DownloadButtons({ file }: { file: LoadedFile }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generated = useMemo(() => moduleDownload(file), [file]);

  async function writeBack() {
    setBusy(true);
    setError(null);
    try {
      const { blob, name } = await rewrittenDocx(file);
      downloadBlob(blob, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => downloadBlob(generated.blob, generated.name)}
      >
        <DownloadIcon />
        {generated.name.endsWith(".zip") ? "JSX + assets" : "JSX"}
      </button>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={writeBack}
        disabled={busy}
        title="The document as react-docx writes it back: what a template made from this file produces"
      >
        <DownloadIcon />
        {busy ? "Writing…" : "Rewritten .docx"}
      </button>
      {error ? (
        <span className="toolbar-error" role="alert">
          Could not write: {error}
        </span>
      ) : null}
    </>
  );
}

function PreviewSheets({
  file,
  zoom,
  target,
  onShown,
}: {
  file: LoadedFile;
  zoom: number;
  target: string | null;
  onShown: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (target === null) return;
    const element = root.current?.querySelector<HTMLElement>(`[data-docx-path="${target}"]`);
    onShown();
    if (!element) return;
    const covered = document.querySelector(".toolbar")?.getBoundingClientRect().bottom ?? 0;
    const top = window.scrollY + element.getBoundingClientRect().top;
    window.scrollTo({ top: top - covered - (window.innerHeight - covered) / 3 });
    element.classList.remove("flash");
    void element.offsetWidth;
    element.classList.add("flash");
  }, [target, onShown]);
  return (
    <div ref={root}>
      <Sheets document={file.document} zoom={zoom} />
    </div>
  );
}

function JsxPanel({ file }: { file: LoadedFile }) {
  const source = file.module.source;
  const assets = file.module.assets.length;
  return (
    <div className="panel-fill jsx-panel">
      <div className="code">
        <div className="code-head">
          <span>
            {file.componentName}.tsx
            {assets ? ` · ${assets} ${assets === 1 ? "asset" : "assets"} in assets/` : ""}
          </span>
          <CopyButton text={source} label="Copy component" />
        </div>
        {source.length > HIGHLIGHT_LIMIT ? (
          <pre>
            <code>{source}</code>
          </pre>
        ) : (
          <Code code={source} />
        )}
      </div>
    </div>
  );
}

type Kind = Diagnostic["kind"];

const KINDS: readonly { kind: Kind; label: string; meaning: string }[] = [
  { kind: "dropped", label: "Dropped", meaning: "docx.js cannot write it, so a template made from this file loses it" },
  { kind: "raw", label: "Kept as XML", meaning: "written back exactly, but not editable as props" },
  { kind: "resolved", label: "Resolved", meaning: "a theme reference turned into its literal value" },
  { kind: "ignored", label: "Ignored", meaning: "editing noise such as revision ids and spell-check marks" },
];

function count(diagnostics: readonly Diagnostic[], kind: Kind): number {
  return diagnostics.reduce((sum, d) => sum + (d.kind !== kind ? 0 : d.kind === "ignored" ? d.count : 1), 0);
}

function DiagnosticsPanel({
  diagnostics,
  onShow,
}: {
  diagnostics: readonly Diagnostic[];
  onShow: (path: string) => void;
}) {
  const [filter, setFilter] = useState<Kind | null>(null);
  const shown = filter === null ? diagnostics : diagnostics.filter((d) => d.kind === filter);
  const located = diagnostics.some((d) => d.kind !== "ignored");

  return (
    <div className="panel-fill diagnostics">
      <div className="container diagnostics-inner">
        <div className="diag-summary" role="group" aria-label="Filter by kind">
          {KINDS.map(({ kind, label, meaning }) => (
            <button
              key={kind}
              type="button"
              className="diag-card"
              data-kind={kind}
              aria-pressed={filter === kind}
              onClick={() => setFilter(filter === kind ? null : kind)}
            >
              <span className="diag-count">{count(diagnostics, kind)}</span>
              <span className="diag-label">
                <span className="diag-dot" />
                {label}
              </span>
              <span className="diag-meaning">{meaning}</span>
            </button>
          ))}
        </div>

        {!located && filter === null ? (
          <div className="empty">
            <strong>Nothing was lost.</strong>
            <p>Every element in this file maps to a react-docx prop, so the JSX holds the whole document.</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">
            <strong>None of this kind.</strong>
            <p>
              <button type="button" className="link-btn" onClick={() => setFilter(null)}>
                Show every kind
              </button>
            </p>
          </div>
        ) : (
          <div className="diag-table-wrap">
            <table className="diag-table">
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col">Element</th>
                  <th scope="col">Where</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d, i) => (
                  <tr key={i}>
                    <td>
                      <span className="diag-kind" data-kind={d.kind}>
                        <span className="diag-dot" />
                        {KINDS.find((k) => k.kind === d.kind)!.label}
                      </span>
                    </td>
                    <td>
                      <code>{d.element}</code>
                    </td>
                    <td className="diag-where">
                      {d.kind === "ignored" ? (
                        <span className="muted">{d.count}× across the file</span>
                      ) : (
                        <>
                          <code className="muted">{d.part}</code>
                          {d.at !== null && d.at.length > 0 ? (
                            <button type="button" className="link-btn" onClick={() => onShow(d.at!.join("."))}>
                              Show in preview
                            </button>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="diag-detail">{d.kind === "ignored" ? "" : d.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

mount("preview", <PreviewPage />);
