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

/**
 * Ask for a server sync shortly after any local save (a finish, brand, size,
 * part or floor-plan change), instead of waiting for the 5 s timer — so the
 * BOQ, which is built on the server, has the change when it is opened.
 * Debounced: the many writes of one action (e.g. every part of an item) go out
 * as one sync. app.tsx listens for "pazl:sync-now"; SyncService sends only
 * what changed and never runs two syncs at once.
 */
let syncSoonTimer: ReturnType<typeof setTimeout> | null = null;
const requestSyncSoon = () => {
  try {
    if (syncSoonTimer) clearTimeout(syncSoonTimer);
    syncSoonTimer = setTimeout(() => {
      syncSoonTimer = null;
      window.dispatchEvent(new Event("pazl:sync-now"));
    }, 400);
  } catch (_) {
    /* the timed sync still sends it */
  }
};

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
        requestSyncSoon();
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
        requestSyncSoon();
        resolve(request.result);
      };
      request.onerror = (event: any) => {
        console.debug("LocalDBManager.ts ~ updateToLocalDB ~ request.onerror");
        resolve(event.target.error);
      };
    });
  }

  /**
   * MERGE CHANGES INTO RECORDS THE BROWSER ALREADY HOLDS.
   *
   * WHY THIS EXISTS. This local store is the source of truth for the sync: it
   * POSTs its own copy of every changed record to the server. So a change
   * written STRAIGHT to the API — as the BOQ's room-level board and interior
   * are, since the BOQ never loads the 3D scene — lands in Mongo and is then
   * quietly overwritten the next time the editor syncs its untouched copy back
   * over it.
   *
   * The symptom is the worst kind: the change applies, the bill reprices, and
   * it is all gone on reload, with nothing having reported an error.
   *
   * So anything written directly to the API is merged in here too, and the sync
   * then carries the same values rather than reverting them.
   *
   * A record the browser does not hold is SKIPPED, not created: its absence
   * means this session never loaded that item, so there is no stale copy to
   * overwrite it and nothing to keep in step.
   */
  async patchLocalRecords(
    storeName: string,
    patch: Record<string, any>,
    ids: string[]
  ): Promise<number> {
    if (!this.db) {
      await this.initLocalDB();
    }
    const unique = Array.from(new Set((ids || []).filter(Boolean)));
    if (!unique.length) return 0;
    return new Promise((resolve) => {
      let written = 0;
      try {
        const transaction = this.db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        unique.forEach((id) => {
          const read = store.get(id);
          read.onsuccess = () => {
            const existing = read.result;
            if (!existing) return;
            store.put({ ...existing, ...patch }, id);
            written += 1;
          };
        });
        transaction.oncomplete = () => {
          // Only ask for a sync when something actually changed locally.
          if (written) requestSyncSoon();
          resolve(written);
        };
        transaction.onerror = () => resolve(written);
      } catch (e) {
        console.error("LocalDBManager.patchLocalRecords", e);
        resolve(written);
      }
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
