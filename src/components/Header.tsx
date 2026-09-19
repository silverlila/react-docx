import React from "react";
import { HeaderProps } from "../types";

// Valid only as a direct child of Section.
export const Header: React.FC<HeaderProps> = ({ children, ...props }) => {
  return React.createElement("RDHeader", props, children);
};
