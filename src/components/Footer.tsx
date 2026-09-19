import React from "react";
import { FooterProps } from "../types";

// Valid only as a direct child of Section.
export const Footer: React.FC<FooterProps> = ({ children, ...props }) => {
  return React.createElement("RDFooter", props, children);
};
