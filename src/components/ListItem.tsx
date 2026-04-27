import React from "react";
import { ListItemProps } from "../types";

export const ListItem: React.FC<ListItemProps> = ({ children, ...props }) => {
  return React.createElement("RDListItem", props, children);
};
