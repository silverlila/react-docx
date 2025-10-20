import React from "react";
import { TextRunProps } from "../types";

export const TextRun: React.FC<TextRunProps> = ({ children, ...props }) => {
  return React.createElement("RDTextRun", props, children);
};
