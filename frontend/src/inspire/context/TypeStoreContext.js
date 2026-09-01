import React, { createContext, useContext } from "react";

const TypeStoreContext = createContext();

const useTypeStore = () => {
  return useContext(TypeStoreContext);
};

export { useTypeStore, TypeStoreContext as default };
