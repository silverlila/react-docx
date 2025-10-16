import React from "react";
import { TableProps, TableRowProps, TableCellProps } from "../types";

export const Table: React.FC<TableProps> = ({ children, ...props }) => {
  return React.createElement("RDTable", props, children);
};

export const TableRow: React.FC<TableRowProps> = ({ children, ...props }) => {
  return React.createElement("RDTableRow", props, children);
};

export const TableCell: React.FC<TableCellProps> = ({ children, ...props }) => {
  return React.createElement("RDTableCell", props, children);
};
