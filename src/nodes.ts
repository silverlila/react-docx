export abstract class MutableNode {
  abstract nodeType: string;
  children: MutableNode[] = [];
  props: any = {};

  constructor(props: any = {}) {
    this.props = props;
  }
}

export class DocumentNode extends MutableNode {
  nodeType = "Document" as const;
}

export class SectionNode extends MutableNode {
  nodeType = "Section" as const;
}

export class ParagraphNode extends MutableNode {
  nodeType = "Paragraph" as const;
}

export class TextRunNode extends MutableNode {
  nodeType = "TextRun" as const;
}

export class TableNode extends MutableNode {
  nodeType = "Table" as const;
}

export class TableRowNode extends MutableNode {
  nodeType = "TableRow" as const;
}

export class TableCellNode extends MutableNode {
  nodeType = "TableCell" as const;
}

export class TabNode extends MutableNode {
  nodeType = "Tab" as const;
}

export class ImageRunNode extends MutableNode {
  nodeType = "ImageRun" as const;
}

export class ExternalHyperlinkNode extends MutableNode {
  nodeType = "ExternalHyperlink" as const;
}

export class InternalHyperlinkNode extends MutableNode {
  nodeType = "InternalHyperlink" as const;
}

export class PageBreakNode extends MutableNode {
  nodeType = "PageBreak" as const;
}

export class BookmarkNode extends MutableNode {
  nodeType = "Bookmark" as const;
}

export class SymbolRunNode extends MutableNode {
  nodeType = "SymbolRun" as const;
}

export class MathNode extends MutableNode {
  nodeType = "Math" as const;
}

export class BreakNode extends MutableNode {
  nodeType = "Break" as const;
}
