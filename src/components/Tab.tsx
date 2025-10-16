import React from "react";
import { TabProps } from "../types";

export const Tab: React.FC<TabProps> = () => {
  return React.createElement("RDTextRun", {}, [
    React.createElement("RDTab", {}),
  ]);
};
