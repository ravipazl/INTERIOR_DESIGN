import React, { createContext, useState, useContext } from "react";

const LoaderContext = createContext<any>({});

export const LoaderProvider = ({ children }:any) => {
  const [isLoading, setLoading] = useState(false);
  return (
    <LoaderContext.Provider value={{isLoading ,setLoading}}>
      {children}
    </LoaderContext.Provider>
  );
};

export default LoaderContext;
