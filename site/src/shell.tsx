import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrandMark, GitHubIcon } from "./ui/icons";
import "./styles.css";

export const GITHUB_URL = "https://github.com/silverlila/react-docx";

type Page = "home" | "preview" | "docs";

const NAV: readonly { page: Page; href: string; label: string }[] = [
  { page: "docs", href: "/docs/", label: "Docs" },
  { page: "preview", href: "/preview/", label: "Preview" },
];

function Header({ current }: { current: Page }) {
  return (
    <header className="site-header">
      <div className="container">
        <a className="brand" href="/" aria-current={current === "home" ? "page" : undefined}>
          <BrandMark />
          react-docx
        </a>
        <nav className="site-nav" aria-label="Main">
          {NAV.map((item) => (
            <a key={item.page} href={item.href} aria-current={item.page === current ? "page" : undefined}>
              {item.label}
            </a>
          ))}
          <a className="icon-link" href={GITHUB_URL} aria-label="react-docx on GitHub">
            <GitHubIcon />
          </a>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <span>react-docx · MIT licence · built on docx.js</span>
        <nav aria-label="Footer">
          <a href="/docs/">Docs</a>
          <a href="/preview/">Preview a file</a>
          <a href={GITHUB_URL}>GitHub</a>
        </nav>
      </div>
    </footer>
  );
}

/** Mounts one page inside the site's header and footer. Each HTML entry calls this once. */
export function mount(current: Page, page: ReactNode): void {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header current={current} />
      <main id="main">{page}</main>
      <Footer />
    </StrictMode>,
  );
}
