import React from "react";
import { ListProps } from "../types";

export const List: React.FC<ListProps> = ({ children, ...props }) => {
  return React.createElement("RDList", props, children);
};
