import React, { useEffect, useState, useContext } from "react";
import "react-perfect-scrollbar/dist/css/styles.css";
import { Spinner } from "react-bootstrap";
import TypeStore from "./TypeStore";
import ProjectContext from "./context/ProjectContext";
import TypeStoreContext from "./context/TypeStoreContext";
import UserContext from "./context/UserContext";
import { getCurrentUser } from "./services/authService";
import { getProject } from "./services/projectService";
import Router from "./routing/Router";
import UserRoleContext from "./context/UserRoleContext";
import { CountProvider } from "./context/CountContext";
import "react-toastify/dist/ReactToastify.css";
import { StepperProvider } from "./context/StepperContext";
import { USER_ROLES } from "./utils/constants";
import { ServiceProvider } from "./context/ServiceContext";

const App = () => {
  const [themeInfo, setThemeInfo] = useState([]);
  const { isLoading, setLoading } = useContext(UserRoleContext);
  const [typeStore, setTypestore] = useState(new TypeStore());
  const [user, setUser] = useState(null);
  const [project, setProject] = useState(null);

  useEffect(() => {
    loadData();
    getCurrentUserAndProjectData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const response = await typeStore.loadDataFromApi();
      if (response && response.length > 0) {
        setThemeInfo(response);
      }
    } catch (error) {
      console.error("Error fetching data from API:", error);
    } finally {
      setLoading(false);
    }
  }

  const getCurrentUserAndProjectData = async () => {
    const userResponse = await getCurrentUser();
    if (userResponse?._id) {
      setUser(userResponse);
      if (userResponse?.permissions === USER_ROLES.USER) {
        const projectResponse = await getProject(userResponse._id);
        if (projectResponse?.data?.length) {
          setProject(projectResponse?.data[0]);
        }
      }
    }
  };

  const setCurrentUser = (data) => {
    setUser(data);
  };

  const setCurrentProject = (data) => {
    setProject(data);
  };

  return (
    <>
      {isLoading ? <div className="loading">Loading</div> : null}
      <ServiceProvider>
        <TypeStoreContext.Provider value={{ typeStore, themeInfo }}>
          <StepperProvider>
            <UserContext.Provider value={{ currentUser: user, setCurrentUser }}>
              <ProjectContext.Provider
                value={{ currentProject: project, setCurrentProject }}
              >
                <CountProvider>
                  <Router />
                </CountProvider>
              </ProjectContext.Provider>
            </UserContext.Provider>
          </StepperProvider>
        </TypeStoreContext.Provider>
      </ServiceProvider>
    </>
  );
};

export default App;
