export enum LocalDBObjectStores {
  FLOOR_PLAN = "pazl-3d-models-floor-plan",
  FURNINSHED_MODEL = "pazl-3d-models-furnished-model",
  FURNINSHED_MODEL_COMPONENT = "pazl-3d-models-furnished-model-component",
}

export const getEntityByStoreName = (storeName: string) => {
  if (LocalDBObjectStores.FLOOR_PLAN === storeName) {
    return Entities.FLOOR_PLAN;
  } else if (LocalDBObjectStores.FURNINSHED_MODEL === storeName) {
    return Entities.FURNINSHED_MODEL;
  } else if (LocalDBObjectStores.FURNINSHED_MODEL_COMPONENT === storeName) {
    return Entities.FURNINSHED_MODEL_COMPONENT;
  }
};

export enum Entities {
  USER = "user",
  CATEGORY = "category",
  FINISHING = "finishing",
  FLOOR_PLAN = "floor-plan",
  PROJECT = "project",
  MODEL = "model",
  TEXTURE = "texture",
  MODEL_COMPONENT = "model-component",
  FURNINSHED_MODEL = "furnished-model",
  FURNINSHED_MODEL_COMPONENT = "furnished-model-component",
  CORE_MATERIAL_BRAND = "core-material-brand",
  CORE_MATERIAL_TYPE = "core-material-type",
}

export const localDBObjectStoresList = [
  `pazl-3d-models-floor-plan`,
  `pazl-3d-models-furnished-model`,
  `pazl-3d-models-furnished-model-component`,
];

export class LocalDBManager {
  private dbName = "pazl-3d-models-db";
  private dbVersion = 4;
  private db: any;

  constructor() {}

  async initLocalDB(isClear?: boolean) {
    console.debug("LocalDBManager.ts ~ initLocalDB");
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      console.debug("LocalDBManager.ts ~ initLocalDB ~ request", request);
      request.onupgradeneeded = () => {
        this.db = request.result;
        console.debug(
          "LocalDBManager.ts ~ initLocalDB ~ onupgradeneeded",
          request.result
        );
        localDBObjectStoresList.map((storeName) => {
          if (!request.result.objectStoreNames.contains(storeName)) {
            request.result.createObjectStore(storeName, {
              autoIncrement: false,
            });
          } else {
            const transaction = request.result.transaction(
              [storeName],
              "readwrite"
            );
            const objectStore = transaction.objectStore(storeName);
            const objectStoreRequest = objectStore.clear();
            objectStoreRequest.onsuccess = (event) => {
              console.debug(
                "LocalDBManager.ts ~ initLocalDB ~ successfully cleared localDB objectStore:",
                storeName
              );
            };
            objectStoreRequest.onerror = (event) => {
              console.debug(
                "LocalDBManager.ts ~ initLocalDB ~ error clearing localDB objectStore:",
                storeName,
                event
              );
            };
          }
        });
      };
      request.onsuccess = () => {
        console.debug(
          "LocalDBManager.ts ~ initLocalDB ~ onsuccess",
          request.result
        );
        this.db = request.result;
        if (isClear) {
          localDBObjectStoresList.map((storeName) => {
            const transaction = request.result.transaction(
              [storeName],
              "readwrite"
            );
            const objectStore = transaction.objectStore(storeName);
            const objectStoreRequest = objectStore.clear();
            objectStoreRequest.onsuccess = (event) => {
              console.debug(
                "LocalDBManager.ts ~ initLocalDB ~ successfully cleared localDB objectStore:",
                storeName
              );
            };
            objectStoreRequest.onerror = (event) => {
              console.debug(
                "LocalDBManager.ts ~ initLocalDB ~ error clearing localDB objectStore:",
                storeName,
                event
              );
            };
          });
        }
        resolve(this.db);
      };
      request.onerror = (event: any) => {
        console.debug("LocalDBManager.ts ~ initLocalDB ~ onerror", event);
        reject(event.target.error);
      };
    });
  }

  protected async saveToLocalDB(data: any, storeName: string): Promise<any> {
    console.debug("LocalDBManager.ts ~ saveToLocalDB", {
      data,
      storeName,
      db: this.db,
    });
    if (!this.db) {
      await this.initLocalDB();
    }
    return new Promise((resolve, reject) => {
      console.debug("LocalDBManager.ts ~ saveToLocalDB ~ db", this.db);
      const transaction = this.db.transaction([storeName], "readwrite");
      console.debug(
        "LocalDBManager.ts ~ saveToLocalDB ~ transaction",
        transaction
      );
      const store = transaction.objectStore(storeName);
      console.debug("LocalDBManager.ts ~ saveToLocalDB ~ store", store);
      const request = store.add(data, data._id);
      console.debug("LocalDBManager.ts ~ saveToLocalDB ~ request", request);
      request.onsuccess = () => {
        console.debug("LocalDBManager.ts ~ saveToLocalDB ~ request.onsuccess");
        resolve(request.result);
      };
      request.onerror = (event: any) => {
        console.debug(
          "LocalDBManager.ts ~ saveToLocalDB ~ request.onerror",
          event
        );
        resolve(event.target.error);
      };
    });
  }

  protected async updateToLocalDB(data: any, storeName: string): Promise<any> {
    console.debug("LocalDBManager.ts ~ updateToLocalDB", {
      data,
      storeName,
      db: this.db,
    });
    if (!this.db) {
      await this.initLocalDB();
    }
    return new Promise((resolve, reject) => {
      console.debug("LocalDBManager.ts ~ updateToLocalDB ~ db", this.db);
      const transaction = this.db.transaction([storeName], "readwrite");
      console.debug(
        "LocalDBManager.ts ~ updateToLocalDB ~ transaction",
        transaction
      );
      const store = transaction.objectStore(storeName);
      console.debug("LocalDBManager.ts ~ updateToLocalDB ~ store", store);
      const request = store.put(data, data._id);
      console.debug("LocalDBManager.ts ~ updateToLocalDB ~ request", request);
      request.onsuccess = () => {
        console.debug(
          "LocalDBManager.ts ~ updateToLocalDB ~ request.onsuccess"
        );
        resolve(request.result);
      };
      request.onerror = (event: any) => {
        console.debug("LocalDBManager.ts ~ updateToLocalDB ~ request.onerror");
        resolve(event.target.error);
      };
    });
  }

  protected async deleteFromLocalDB(
    data: any,
    storeName: string
  ): Promise<any> {
    console.debug("LocalDBManager.ts ~ deleteFromLocalDB", {
      data,
      storeName,
      db: this.db,
    });
    if (!this.db) {
      await this.initLocalDB();
    }
    data.isDeleted = true;
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], "readwrite");
      console.debug(
        "LocalDBManager.ts ~ deleteFromLocalDB ~ transaction",
        transaction
      );
      const store = transaction.objectStore(storeName);
      console.debug("LocalDBManager.ts ~ deleteFromLocalDB ~ store", store);
      const request = store.put(data, data._id);
      console.debug("LocalDBManager.ts ~ deleteFromLocalDB ~ request", request);
      request.onsuccess = () => {
        console.debug(
          "LocalDBManager.ts ~ deleteFromLocalDB ~ request.onsuccess"
        );
        resolve(request.result);
      };
      request.onerror = (event: any) => {
        console.debug(
          "LocalDBManager.ts ~ deleteFromLocalDB ~ request.onerror"
        );
        resolve(event.target.error);
      };
    });
  }

  async getDataFromLocalDB(storeName: string) {
    console.debug(
      "LocalDBManager.ts ~ getDataFromLocalDB ~ storeName",
      storeName
    );
    return new Promise((resolve, reject) => {
      console.debug("LocalDBManager.ts ~ getDataFromLocalDB ~ db", this.db);
      const transaction = this.db.transaction([storeName], "readonly");
      console.debug(
        "LocalDBManager.ts ~ getDataFromLocalDB ~ transaction",
        transaction
      );
      const store = transaction.objectStore(storeName);
      console.debug("LocalDBManager.ts ~ getDataFromLocalDB ~ store", store);
      const request = store.getAll();
      console.debug(
        "LocalDBManager.ts ~ getDataFromLocalDB ~ request",
        request
      );
      request.onsuccess = () => {
        console.debug(
          "LocalDBManager.ts ~ getDataFromLocalDB ~ request.onsuccess"
        );
        resolve(request.result);
      };
      request.onerror = (event: any) => {
        console.debug(
          "LocalDBManager.ts ~ getDataFromLocalDB ~ request.onerror"
        );
        resolve(event.target.error);
      };
    });
  }
}
