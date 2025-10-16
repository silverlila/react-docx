import React from "react";
import { SectionProps } from "../types";

/**
 * Section component - Represents a section within a document
 * Maps to DOCX ISectionOptions
 *
 * Sections allow you to have different page layouts, headers, footers, etc.
 * within a single document.
 *
 * @example
 * <Document>
 *   <Section properties={{ page: { margin: { top: 1440, bottom: 1440 } } }}>
 *     <Paragraph>Content for section 1</Paragraph>
 *   </Section>
 *   <Section>
 *     <Paragraph>Content for section 2</Paragraph>
 *   </Section>
 * </Document>
 */
export const Section: React.FC<SectionProps> = ({ children, ...props }) => {
  return React.createElement("RDSection", props, children);
};
