import { useEffect, useRef, useState } from "react";
import { highlight } from "./highlight";
import { CheckIcon, CopyIcon } from "./icons";

export function CopyButton({ text, label = "Copy code" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button type="button" className="copy-btn" onClick={copy} aria-label={label} data-copied={copied || undefined}>
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span className="visually-hidden" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}

export function Code({ code, language = "tsx" }: { code: string; language?: "tsx" | "sh" }) {
  const text = code.trimEnd();
  return (
    <pre>
      <code>
        {language === "sh"
          ? text
          : highlight(text).map((token, i) =>
              token.kind === "plain" ? (
                token.text
              ) : (
                <span key={i} className={`tok-${token.kind}`}>
                  {token.text}
                </span>
              ),
            )}
      </code>
    </pre>
  );
}

export function CodeBlock({ code, title, language }: { code: string; title?: string; language?: "tsx" | "sh" }) {
  return (
    <div className="code">
      {title ? (
        <div className="code-head">
          <span>{title}</span>
          <CopyButton text={code.trimEnd()} />
        </div>
      ) : (
        <div className="code-floating-copy">
          <CopyButton text={code.trimEnd()} />
        </div>
      )}
      <Code code={code} language={language} />
    </div>
  );
}

export function InstallCommand({ command }: { command: string }) {
  return (
    <div className="install">
      <span className="prompt">$</span>
      <code>{command}</code>
      <CopyButton text={command} label="Copy install command" />
    </div>
  );
}
