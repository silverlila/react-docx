import React from "react";
import { BookmarkProps } from "../types";

export const Bookmark: React.FC<BookmarkProps> = ({ children, ...props }) => {
  return React.createElement("RDBookmark", props, children);
};
