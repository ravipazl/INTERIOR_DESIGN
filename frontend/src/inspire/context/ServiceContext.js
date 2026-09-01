import React, { createContext, useContext } from "react";
import AuthService from "../services/authService";
import ImagesService from "../services/imagesService";

const ServiceContext = createContext();

const useServices = () => {
  return useContext(ServiceContext);
};

export const ServiceProvider = ({ children }) => {
    const authService = new AuthService();
    const imagesService = new ImagesService();
  return (
    <ServiceContext.Provider value={{authService, imagesService}}>
      {children}
    </ServiceContext.Provider>
  )
};

export { useServices, ServiceContext as default };