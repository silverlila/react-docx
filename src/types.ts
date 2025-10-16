import { ReactElement, ReactNode } from "react";
import * as docx from "docx";

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

export type MutableTreeNode =
  | DocumentNode
  | SectionNode
  | ParagraphNode
  | TextRunNode
  | TableNode
  | TableRowNode
  | TableCellNode
  | TabNode
  | ImageRunNode
  | ExternalHyperlinkNode
  | InternalHyperlinkNode
  | PageBreakNode
  | BookmarkNode
  | SymbolRunNode
  | MathNode
  | BreakNode;

export type ElementType =
  | "RDDocument"
  | "RDSection"
  | "RDParagraph"
  | "RDTextRun"
  | "RDTable"
  | "RDTableRow"
  | "RDTableCell"
  | "RDTab"
  | "RDImageRun"
  | "RDExternalHyperlink"
  | "RDInternalHyperlink"
  | "RDPageBreak"
  | "RDBookmark"
  | "RDSymbolRun"
  | "RDMath"
  | "RDBreak";

export type DocxInstance = MutableTreeNode;

// ============================================
// COMPONENT PROP TYPES
// ============================================

type NotReadonly<T> = {
  -readonly [K in keyof T]: T[K] extends object ? NotReadonly<T[K]> : T[K];
};

export interface DocumentProps
  extends NotReadonly<Omit<docx.IPropertiesOptions, "sections" | "children">> {
  children?: ReactNode;
}

export interface SectionProps
  extends NotReadonly<Omit<docx.ISectionOptions, "children">> {
  children?: ReactNode;
}

export interface ParagraphProps
  extends NotReadonly<Omit<docx.IParagraphOptions, "children">> {
  children?: ReactNode;
}

export interface TextRunProps extends NotReadonly<docx.IRunOptions> {
  children?: never;
}

export interface TableProps
  extends NotReadonly<Omit<docx.ITableOptions, "rows" | "children">> {
  children?: ReactNode;
}

export interface TableRowProps
  extends NotReadonly<Omit<docx.ITableRowOptions, "children">> {
  children?: ReactNode;
}

export interface TableCellProps
  extends NotReadonly<Omit<docx.ITableCellOptions, "children">> {
  children?: ReactNode;
}

export interface TabProps {
  children?: never;
}

export type ImageRunProps = NotReadonly<docx.IImageOptions> & {
  children?: never;
};

export interface ExternalHyperlinkProps {
  link: string;
  children?: ReactNode;
}

export interface InternalHyperlinkProps {
  anchor: string;
  children?: ReactNode;
}

export interface PageBreakProps {
  children?: never;
}

export interface BookmarkProps {
  id: string;
  children?: ReactNode;
}

export type SymbolRunProps = NotReadonly<docx.ISymbolRunOptions> & {
  children?: never;
};

export interface MathProps {
  text: string;
  children?: never;
}

export interface BreakProps {
  children?: never;
}

export interface DocxContainer {
  rootInstance: DocumentNode | null;
}

export type RenderFunction = (element: ReactElement) => Promise<Buffer>;
