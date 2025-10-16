import React from "react";
import { MathProps } from "../types";

export const Math: React.FC<MathProps> = ({ children, ...props }) => {
  return React.createElement("RDMath", props, children);
};
