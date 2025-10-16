import React from "react";
import { BreakProps } from "../types";

/**
 * Break component - Creates a line break within a paragraph
 * Maps to DOCX Break class
 *
 * @example
 * <Paragraph>
 *   <TextRun text="First line" />
 *   <Break />
 *   <TextRun text="Second line" />
 * </Paragraph>
 */
export const Break: React.FC<BreakProps> = () => {
  return React.createElement("RDBreak", {});
};
