import axios from "axios";
import { Project } from "../entities";
import apiService from "./apiService";
import { AuthService } from "./authService";
import { UserPermission } from "@pazl/entities/User";

export const ProjectsService = {
  getAllProjects: async () => {
    try {
      const accessToken = AuthService.getAccessToken();
      const currentUser = AuthService.getCurrentUser();
      if (currentUser?._id) {
        const config =
          currentUser.permissions === UserPermission.ADMIN ||
          currentUser.permissions === UserPermission.SUPER_ADMIN
            ? {
                headers: {
                  Authorization: `${accessToken}`,
                },
              }
            : currentUser?.permissions === UserPermission.ARCHITECT
            ? {
                params: {
                  "$or[0][architectUserId]": currentUser._id,
                  "$or[1][sharedUserIDs]": currentUser._id,
                },
                headers: {
                  Authorization: `${accessToken}`,
                },
              }
            : {
                params: {
                  "$or[0][ownerUserId]": currentUser._id,
                  "$or[1][sharedUserIDs]": currentUser._id,
                },
                headers: {
                  Authorization: `${accessToken}`,
                },
              };
        const response = await apiService.get("/projects", config);
        console.debug(
          "projectsService.ts ~ getAllProjects ~ response",
          response
        );
        if (
          response?.data &&
          response?.status >= 200 &&
          response?.status < 300
        ) {
          return response.data;
        }
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: projectsService.ts ~ getAllProjects ~ err:",
        err
      );
      return null;
    }
  },
  getProjectById: async (id: string): Promise<Project | null> => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await apiService.get(`/projects/${id}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.debug("projectsService.ts ~ getProjectById ~ response", response);
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return new Project({
          _id: response?.data?._id,
          address: response?.data?.address,
          clientName: response?.data?.clientName,
          name: response?.data?.name,
          status: response?.data?.status,
          ownerUserId: response?.data?.ownerUserId,
          ownerUser: response?.data?.ownerUser,
          shareId: response?.data?.shareId,
          sharedUserIDs: response?.data?.sharedUserIDs,
          sharedUsers: response?.data?.sharedUsers,
          architectUserId: response?.data?.architectUserId,
          architectUser: response?.data?.architectUser,
          defaultUnits: response?.data?.defaultUnits,
          boqNumber: response?.data?.boqNumber,
          revisedBoqNumber: response?.data?.revisedBoqNumber,
          clientEmail: response?.data?.clientEmail,
          clientGSTNumber: response?.data?.clientGSTNumber,
          clientPhoneNumber: response?.data?.clientPhoneNumber,
          createdAt: response?.data?.createdAt,
          updatedAt: response?.data?.updatedAt,
        });
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: projectsService.ts ~ getProjectById ~ err:",
        err
      );
      return null;
    }
  },
  createProject: async (data: any) => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await apiService.post(`/projects`, data, {
        headers: {
          Authorization: `${accessToken}`,
        },
      });
      // Reuse the SAME id when mirroring the project into the AI database.
      // Previously each database auto-generated its own id, so one project had
      // two different ids — which broke AI Inspiration (and update/delete on the
      // AI copy). Passing the design id keeps both copies aligned forever.
      const sharedId = response?.data?._id;
      const response2 = await axios.post(
        `${process.env.REACT_APP_PAZL_INSPIRE_API_BASE_URL}/projects`,
        sharedId ? { ...data, _id: sharedId } : data,
        {
          headers: {
            Authorization: `${accessToken}`,
          },
        }
      );
      console.debug("projectsService.ts ~ createProject ~ response", response);
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: projectsService.ts ~ createProject ~ err:",
        err
      );
      return null;
    }
  },
  updateProject: async (projectId: string, data: any) => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await apiService.patch(`/projects/${projectId}`, data, {
        headers: {
          Authorization: `${accessToken}`,
        },
      });
      const response2 = await axios.patch(
        `${process.env.REACT_APP_PAZL_INSPIRE_API_BASE_URL}/projects/${projectId}`,
        data,
        {
          headers: {
            Authorization: `${accessToken}`,
          },
        }
      );
      console.debug("projectsService.ts ~ updateProject ~ response", response);
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: projectsService.ts ~ updateProject ~ err:",
        err
      );
      return null;
    }
  },
  deleteProject: async (projectId: string) => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await apiService.delete(`/projects/${projectId}`, {
        headers: {
          Authorization: `${accessToken}`,
        },
      });
      const response2 = await axios.delete(
        `${process.env.REACT_APP_PAZL_INSPIRE_API_BASE_URL}/projects/${projectId}`,
        {
          headers: {
            Authorization: `${accessToken}`,
          },
        }
      );
      console.debug("projectsService.ts ~ deleteProject ~ response", response);
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: projectsService.ts ~ deleteProject ~ err:",
        err
      );
      return null;
    }
  },
  shareProjectToUser: async (projectId: string, userEmailId: string) => {
    try {
      const accessToken = AuthService.getAccessToken();
      const response = await apiService.post(
        `/shareproject`,
        { userEmailId, projectId },
        {
          headers: {
            Authorization: `${accessToken}`,
          },
        }
      );
      console.debug(
        "projectsService.ts ~ shareProjectToUser ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return response.data;
      }
      return null;
    } catch (err) {
      console.error(
        "🚀 ~ file: projectsService.ts ~ shareProjectToUser ~ err:",
        err
      );
      return null;
    }
  },
};
