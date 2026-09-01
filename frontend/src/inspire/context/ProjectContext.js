import React, { createContext, useContext } from "react";

const ProjectContext = createContext();

const useTypeStore = () => {
  return useContext(ProjectContext);
};

export { useTypeStore, ProjectContext as default };
