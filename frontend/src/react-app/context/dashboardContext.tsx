import React, { useState } from "react";

const DashboardContext = React.createContext({});

export const DashboardProvider = ({ children }: any) => {
  const [bluePrintData, setBluePrintData] = useState({
    blueprint3d: null,
    selectedPoint: null,
    selectedModels: null,
    wallSelected: false,
    selectedColors: null,
    selectedMesh: null,
    selectedMeshList: null,
    configurationHelper: null,
    floorPlanningHelper: null,
    roomPlanningHelper: null,
  });
  const [loading, setLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  return (
    <DashboardContext.Provider
      value={{
        bluePrintData,
        setBluePrintData,
        loading,
        setLoading,
        darkMode,
        setDarkMode,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
};

export default DashboardProvider;
export { DashboardContext };
