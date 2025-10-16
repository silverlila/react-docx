import React from "react";
import { ExternalHyperlinkProps, InternalHyperlinkProps } from "../types";

export const ExternalHyperlink: React.FC<ExternalHyperlinkProps> = ({
  children,
  ...props
}) => {
  return React.createElement("RDExternalHyperlink", props, children);
};

export const InternalHyperlink: React.FC<InternalHyperlinkProps> = ({
  children,
  ...props
}) => {
  return React.createElement("RDInternalHyperlink", props, children);
};
