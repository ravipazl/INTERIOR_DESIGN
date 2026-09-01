import React, { createContext, useContext } from "react";

const UserContext = createContext();

const useTypeStore = () => {
  return useContext(UserContext);
};

export { useTypeStore, UserContext as default };
