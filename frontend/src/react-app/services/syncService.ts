import BlueprintInterface from "@pazl/blueprint-interface";
import axios from "./apiService";
import { AuthService } from "./authService";
import {
  getEntityByStoreName,
  LocalDBManager,
  localDBObjectStoresList,
} from "./LocalDBManager";

const getDataFromLocalDB = async () => {
  const localDB = new LocalDBManager();
  await localDB.initLocalDB();
  let dataList: any[] = [];
  await Promise.all(
    localDBObjectStoresList.map(async (storeName) => {
      let data: any = await localDB.getDataFromLocalDB(storeName);
      if (data?.length) {
        data = await Promise.all(
          data.map(async (item: any) => {
            let resp = {
              ...item,
              entity: getEntityByStoreName(storeName),
            };
            delete resp.id;
            return resp;
          })
        );
        dataList = dataList.concat(data);
      }
    })
  );
  return dataList;
};

export const SyncService = {
  syncToDB: async (): Promise<boolean> => {
    try {
      const data = await getDataFromLocalDB();
      console.debug("🚀 ~ file: syncService.ts ~ syncToDB ~ data", data);
      const accessToken = AuthService.getAccessToken();
      const response = await axios.post("/sync", data, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.debug(
        "🚀 ~ file: syncService.ts ~ syncToDB ~ response",
        response
      );
      if (response?.data && response?.status >= 200 && response?.status < 300) {
        return true;
      }
      return false;
    } catch (err) {
      console.error("🚀 ~ file: syncService.js ~ syncToDB ~ err:", err);
      return false;
    }
  },
};
