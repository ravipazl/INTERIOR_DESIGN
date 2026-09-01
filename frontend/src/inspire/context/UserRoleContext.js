import React, { createContext, useState, useContext } from "react";

const UserRoleContext = createContext();

export const useUserRole = () => {
  const context = useContext(UserRoleContext);
  if (!context) {
    throw new Error("useUserRole must be used within a UserRoleProvider");
  }
  return context.userRole;
};

export const UserRoleProvider = ({ children }) => {
  const [userRole, setUserRole] = useState();
  const [isLoading, setLoading] = useState(false);
  return (
    <UserRoleContext.Provider value={{ userRole, setUserRole, isLoading, setLoading }}>
      {children}
    </UserRoleContext.Provider>
  );
};

export default UserRoleContext;
