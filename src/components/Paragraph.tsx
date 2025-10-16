import React from "react";
import { ParagraphProps } from "../types";

export const Paragraph: React.FC<ParagraphProps> = ({ children, ...props }) => {
  return React.createElement("RDParagraph", props, children);
};
