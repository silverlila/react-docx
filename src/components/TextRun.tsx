import React from "react";
import { TextRunProps } from "../types";

export const TextRun: React.FC<TextRunProps> = (props) => {
  return React.createElement("RDTextRun", props);
};
