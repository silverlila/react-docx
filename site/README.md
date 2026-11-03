# react-docx site

The project's website: a landing page, the docs, and a previewer that opens any `.docx` in the browser.

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # type-checks, then writes dist/
```

- It runs on the library's source (`../src`) through Vite aliases, so it always shows the code in this repo,
  with no library build step.
- Three pages, three HTML entries: `index.html`, `preview/index.html`, `docs/index.html`. Links between them are
  plain links; there is no client router, so `dist/` can be served by any static host.
- Every example on the site is a real component in `src/examples/`. A page imports it twice: once to render it,
  and once with `?raw` to show its source, so the code shown is always the code that ran.
- `docx` is pinned to the version the library is tested against, and deduped with the library's copy.
