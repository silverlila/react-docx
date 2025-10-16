import React from "react";
import { DocumentProps } from "../types";

export const Document: React.FC<DocumentProps> = ({ children, ...props }) => {
  return React.createElement("RDDocument", props, children);
};
