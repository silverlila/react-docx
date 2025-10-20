import { ReactElement, ReactNode } from "react";
import * as docx from "docx";
import {
  DocumentNode,
  SectionNode,
  ParagraphNode,
  TextRunNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  TabNode,
  ImageRunNode,
  ExternalHyperlinkNode,
  InternalHyperlinkNode,
  PageBreakNode,
  BookmarkNode,
  SymbolRunNode,
  MathNode,
  BreakNode,
} from "./nodes";

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

type NotReadonly<T> = {
  -readonly [K in keyof T]: T[K] extends object
    ? T[K] extends any[]
      ? T[K]
      : NotReadonly<T[K]>
    : T[K];
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

export interface TextRunProps
  extends NotReadonly<Omit<docx.IRunOptions, "children">> {
  children?: ReactNode;
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
