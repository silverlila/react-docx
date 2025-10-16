import React from "react";
import { ImageRunProps } from "../types";

export const ImageRun = (props: ImageRunProps) => {
  return React.createElement("RDImageRun", props as any);
};
