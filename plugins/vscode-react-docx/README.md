# React-DOCX Preview Extension

Live preview your React-DOCX documents directly in VSCode!

## Features

- 📄 **Live Preview** - See your DOCX documents rendered in real-time as you type
- 💾 **Export to DOCX** - Export your React components to actual Word documents
- ⚡ **Fast** - Instant feedback using mammoth.js
- 🎨 **Word-like Styling** - Preview looks similar to Microsoft Word

## Usage

### Opening Preview

1. Open any `.tsx` or `.jsx` file that uses react-docx components
2. Click the **preview icon** in the top-right corner of the editor (or)
3. Run command: `React-DOCX: Open Preview` from the Command Palette (Cmd+Shift+P / Ctrl+Shift+P)

### Exporting to DOCX

1. Run command: `React-DOCX: Export to DOCX` from the Command Palette
2. Choose where to save the file
3. Open the exported DOCX in Microsoft Word or Google Docs

## Requirements

Your file should:
- Export a React component using react-docx components
- Be runnable (all imports should resolve)

## Example

```tsx
import React from "react";
import { Document, Section, Paragraph, TextRun } from "@react-docx/core";

export default function MyDocument() {
  return (
    <Document>
      <Section>
        <Paragraph>
          <TextRun text="Hello World!" bold={true} />
        </Paragraph>
      </Section>
    </Document>
  );
}
```

## Known Limitations

- Preview is ~80-90% accurate (mammoth.js limitation)
- Complex layouts may look slightly different
- Always export to DOCX for final review

## Feedback

Report issues at: https://github.com/silverlila/react-docx
